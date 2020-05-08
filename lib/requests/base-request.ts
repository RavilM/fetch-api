import nodeFetch from 'node-fetch';
import {
  RequestRacerParams,
  ParseResponseParams,
  IRequestParams,
  FormattedEndpointParams,
  IResponse,
  IJSONPRCRequestParams,
  GetIsomorphicFetchParamsType,
  GetIsomorphicFetchReturnsType,
  GetFetchBodyParamsType,
} from '@/types/types';
import {
  parseTypesMap,
  requestProtocolsMap,
  NETWORK_ERROR_KEY,
  TIMEOUT_ERROR_KEY,
} from '@/constants/shared';
import { StatusValidator } from '../validators/response-status-validator';
import { FormatDataTypeValidator } from '../validators/response-type-validator';
import { ErrorResponseFormatter } from '../errors-formatter/error-response-formatter';
import { TIMEOUT_VALUE } from '../constants/timeout';
import { jsonParser } from '../utils/parsers/json-parser';
import { blobParser } from '../utils/parsers/blob-parser';
import { objectToQueryString } from '../utils/object-to-query-string';
import { FormatResponseFactory } from '@/formatters/format-response-factory';

interface IBaseRequests {
  makeFetch: (
    values: IRequestParams &
      IJSONPRCRequestParams & {
        requestProtocol: keyof typeof requestProtocolsMap;
      } & { method: string }
  ) => Promise<IResponse>;

  requestRacer: (params: RequestRacerParams) => Promise<any>;

  parseResponseData: (data: ParseResponseParams) => any;

  getIsomorphicFetch: (
    params: GetIsomorphicFetchParamsType
  ) => GetIsomorphicFetchReturnsType;
}

export class BaseRequest implements IBaseRequests {
  parseResponseData = ({
    response,
    parseType,
    isResponseOk,
  }: ParseResponseParams) => {
    // if not 200 then always get json format
    if (!isResponseOk) {
      return jsonParser(response);
    }

    switch (parseType) {
      case parseTypesMap.json:
        return jsonParser(response);

      case parseTypesMap.blob:
        return blobParser(response);

      // default parse to json
      default:
        return jsonParser(response);
    }
  };

  // get an isomorfic fetch
  getIsomorphicFetch = ({
    endpoint,
    fetchParams,
  }: GetIsomorphicFetchParamsType): GetIsomorphicFetchReturnsType => {
    if (typeof window === 'undefined') {
      const requestFetch = (nodeFetch.bind(
        // eslint-disable-line
        null,
        endpoint,
        fetchParams
      ) as () => Promise<unknown>) as () => Promise<IResponse>;

      return { requestFetch };
    }

    const fetchController = new AbortController();

    const requestFetch = (window.fetch.bind(null, endpoint, {
      ...fetchParams,
      signal: fetchController.signal,
    }) as () => Promise<unknown>) as () => Promise<IResponse>;

    return {
      requestFetch,
      fetchController,
    };
  };

  // get serialized endpoint
  getFormattedEndpoint = ({
    endpoint,
    queryParams,
  }: FormattedEndpointParams): string => {
    if (!Boolean(queryParams)) {
      return endpoint;
    }

    return `${endpoint}?${objectToQueryString(queryParams)}`;
  };

  // get formatted fetch body in needed
  getFetchBody = ({
    requestProtocol,
    body,
    method,
    version,
    id,
  }: GetFetchBodyParamsType) => {
    if (method === 'GET') {
      return undefined;
    }

    if (requestProtocol === requestProtocolsMap.jsonRpc) {
      return JSON.stringify({ ...body, ...version, id });
    } else {
      if (body instanceof FormData) {
        return body;
      } else {
        return JSON.stringify(body);
      }
    }
  };

  makeFetch = <
    MakeFetchType extends IRequestParams &
      Partial<IJSONPRCRequestParams> & {
        requestProtocol: keyof typeof requestProtocolsMap;
      } & { method: string }
  >({
    id,
    version,
    headers,
    body,
    mode,
    method,
    endpoint,
    parseType,
    queryParams,
    responseSchema,
    requestProtocol,
    isErrorTextStraightToOutput,
    extraValidationCallback,
    translateFunction,
  }: MakeFetchType): Promise<IResponse> => {
    const formattedEndpoint = this.getFormattedEndpoint({
      endpoint,
      queryParams,
    });

    const fetchBody = this.getFetchBody({
      requestProtocol,
      body,
      version,
      method,
      id,
    });

    const { requestFetch, fetchController } = this.getIsomorphicFetch({
      endpoint: formattedEndpoint,
      fetchParams: {
        body: fetchBody,
        mode,
        headers,
        method,
      },
    });

    const request = requestFetch()
      .then(async (response: any) => {
        const statusValidator = new StatusValidator();
        const isValidStatus = statusValidator.getStatusIsFromWhiteList(
          response.status
        );
        const isResponseOk = response.ok;

        if (isValidStatus) {
          // any type because we did not know about data structure
          const respondedData: any = await this.parseResponseData({
            response,
            parseType,
            isResponseOk,
          });

          // validate the format of the request
          const formatDataTypeValidator = new FormatDataTypeValidator().getFormatValidateMethod(
            {
              protocol: requestProtocol,
              extraValidationCallback,
            }
          );

          // get the full validation result
          const isFormatValid: boolean = formatDataTypeValidator({
            response: respondedData,
            schema: responseSchema,
            prevId: id,
          });

          if (isFormatValid) {
            // get the formatter func
            const responseFormatter = new FormatResponseFactory().createFormatter(
              {
                ...respondedData,
                translateFunction,
                protocol: requestProtocol,
                isErrorTextStraightToOutput,
              }
            );

            // format data
            const formattedResponseData = responseFormatter.getFormattedResponse();

            return formattedResponseData;
          }
        }

        // if not status from the whitelist - throw error with default error
        throw new Error(
          isErrorTextStraightToOutput ? response.statusText : NETWORK_ERROR_KEY
        );
      })
      .catch((error) => {
        console.error('(fetch-api): get error in the request', error.message);

        return new ErrorResponseFormatter().getFormattedErrorResponse({
          translateFunction,
          errorTextKey: error.message,
          isErrorTextStraightToOutput,
        });
      });

    return this.requestRacer({
      request,
      fetchController,
      translateFunction,
      isErrorTextStraightToOutput,
    });
  };

  requestRacer = ({
    request,
    fetchController,
    translateFunction,
    isErrorTextStraightToOutput,
  }: RequestRacerParams): Promise<IResponse> => {
    const timeoutException: Promise<IResponse> = new Promise((resolve) =>
      setTimeout(() => {
        const defaultError: IResponse = new ErrorResponseFormatter().getFormattedErrorResponse(
          {
            translateFunction,
            errorTextKey: TIMEOUT_ERROR_KEY,
            isErrorTextStraightToOutput,
          }
        );

        // if the window fetch
        if (typeof window !== 'undefined') {
          fetchController.abort();
        }

        resolve(defaultError);
      }, TIMEOUT_VALUE)
    );

    return Promise.race([request, timeoutException]);
  };
}
