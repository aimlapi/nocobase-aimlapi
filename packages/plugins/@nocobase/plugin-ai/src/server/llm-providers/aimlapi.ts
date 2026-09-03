/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { ChatOpenAI } from '@langchain/openai';
import { serverRequest } from '@nocobase/utils';
import { LLMProviderMeta, SupportedModel } from '../manager/ai-manager';
import { LLMProvider } from './provider';

const AIMLAPI_BASE_URL = 'https://api.aimlapi.com/v1';
const AIMLAPI_HOSTNAME = 'api.aimlapi.com';
const CHAT_COMPLETIONS_MODEL_TYPE = 'openai/chat-completions';

/**
 * Attribution headers sent with every AI/ML API request. `HTTP-Referer` and `X-Title` follow the OpenRouter
 * convention and identify the calling application (NocoBase, not AI/ML API); the `X-AIMLAPI-*` pair identifies the
 * integration itself so AI/ML API can attribute traffic to it. Frozen because it is shared by every provider
 * instance — callers get a copy, never this object.
 */
export const AIMLAPI_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'HTTP-Referer': 'https://github.com/nocobase/nocobase',
  'X-Title': 'NocoBase',
  'X-AIMLAPI-Partner-ID': 'part_vIQFIgEDs9Yk0yizVcgoM5Sp',
  'X-AIMLAPI-Source': 'agent/nocobase',
});

export type AimlapiModel = {
  id: string;
  type?: string;
};

/**
 * The catalog exposes every endpoint family (image, video, speech, embeddings, ...) under the same list, so entries
 * have to be narrowed to the Chat Completions surface this provider talks to. Entries with no `type` are kept: a user
 * may point `baseURL` at another OpenAI-compatible endpoint whose catalog carries no such metadata.
 */
export function supportsChatCompletions(model: AimlapiModel): boolean {
  return typeof model.type !== 'string' || model.type === CHAT_COMPLETIONS_MODEL_TYPE;
}

export class AimlapiProvider extends LLMProvider {
  declare chatModel: ChatOpenAI;

  get baseURL() {
    return AIMLAPI_BASE_URL;
  }

  /**
   * Attribution travels to AI/ML API only. `baseURL` is user-configurable, so it may point at another vendor or at a
   * proxy that merely fronts the same API, and neither should receive these headers.
   */
  protected buildDefaultHeaders(): Record<string, string> {
    const { httpReferer, xTitle } = this.serviceOptions || {};
    const headers: Record<string, string> = this.isAimlapiOrigin() ? { ...AIMLAPI_ATTRIBUTION_HEADERS } : {};
    if (httpReferer) {
      headers['HTTP-Referer'] = httpReferer;
    }
    if (xTitle) {
      headers['X-Title'] = xTitle;
    }
    return headers;
  }

  protected isAimlapiOrigin(): boolean {
    try {
      return new URL(this.getResolvedBaseURL()).hostname === AIMLAPI_HOSTNAME;
    } catch {
      return false;
    }
  }

  createModel() {
    const { apiKey } = this.serviceOptions || {};
    const { responseFormat, structuredOutput } = this.modelOptions || {};
    const { name, schema } = structuredOutput || {};
    const responseFormatOptions: Record<string, unknown> = {
      type: responseFormat ?? 'text',
    };

    if (responseFormat === 'json_schema' && schema) {
      responseFormatOptions.json_schema = {
        schema,
        name: name ?? 'schema',
      };
    }

    const defaultHeaders = this.buildDefaultHeaders();

    return new ChatOpenAI({
      apiKey,
      ...this.modelOptions,
      modelKwargs: {
        response_format: responseFormatOptions,
      },
      configuration: {
        baseURL: this.getResolvedBaseURL(),
        ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
      },
    });
  }

  async listModels(): Promise<{
    models?: { id: string }[];
    code?: number;
    errMsg?: string;
  }> {
    const { apiKey } = this.serviceOptions || {};
    let url: string;

    try {
      url = this.buildRequestURL('models');
    } catch (error) {
      return { code: 400, errMsg: error instanceof Error ? error.message : String(error) };
    }

    if (!apiKey) {
      return { code: 400, errMsg: 'API Key required' };
    }

    try {
      const response = await serverRequest({
        method: 'GET',
        url,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...this.buildDefaultHeaders(),
        },
      });
      const models = Array.isArray(response?.data?.data) ? (response.data.data as AimlapiModel[]) : [];

      return {
        models: models.filter(supportsChatCompletions).map(({ id }) => ({ id })),
      };
    } catch (error) {
      return {
        code: 500,
        errMsg: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const aimlapiProviderOptions: LLMProviderMeta = {
  title: 'aimlapi.com',
  supportedModel: [SupportedModel.LLM],
  provider: AimlapiProvider,
};
