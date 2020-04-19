import {
  IRESTPureResponse,
  GetIsSchemaResponseValidParams,
  GetCompareIdsParams,
  GetFormatValidateMethodParams,
  IJSONRPCPureResponse,
} from '@/types/types';
import { requestProtocolsMap } from '@/constants/shared';

interface IResponseFormatValidator {
  getIsRestFormatResponseValid: (response: IRESTPureResponse) => boolean;

  getIsJSONRPCFormatResponseValid: (params: IJSONRPCPureResponse) => boolean;

  getIsSchemaResponseValid: (params: GetIsSchemaResponseValidParams) => boolean;

  getCompareIds: ({ requestId, responceId }: GetCompareIdsParams) => boolean;

  getRestFormatIsValid: (response: any) => boolean;

  getJSONRPCFormatIsValid: (response: any) => boolean;

  getFormatValidateMethod: (params: GetFormatValidateMethodParams) => any; // todo fix any type in next release
}

export class FormatDataTypeValidator implements IResponseFormatValidator {
  public getIsRestFormatResponseValid = (response: IRESTPureResponse) =>
    'error' in response &&
    'errorText' in response &&
    'additionalErrors' in response &&
    'data' in response;

  public getIsJSONRPCFormatResponseValid = (response: IJSONRPCPureResponse) =>
    Boolean(
      ('result' in response ||
        (response.error &&
          'code' in response.error &&
          'data' in response.error &&
          'trKey' in response.error.data &&
          'message' in response.error)) &&
        'jsonrpc' in response &&
        'id' in response,
    );

  public getIsSchemaResponseValid = ({
    data,
    error,
    schema,
  }: GetIsSchemaResponseValidParams) => {
    // if the error flag is true
    if (error) {
      return true;
    }

    const validationResult = schema.validate(data);

    return !Boolean(validationResult.error);
  };

  public getCompareIds = ({ requestId, responceId }: GetCompareIdsParams) =>
    requestId === responceId;

  // todo fix any type
  public getRestFormatIsValid = ({ response, schema }: any) => {
    if (!Boolean(response)) {
      console.error('response is empty');
      return false;
    }

    const isFormatValid = this.getIsRestFormatResponseValid(response);

    // if the base format is not valid
    if (!isFormatValid) {
      console.error('response base format is not valid');
      return false;
    }

    const isSchemaRequestValid = this.getIsSchemaResponseValid({
      data: response.data,
      error: response.error,
      schema,
    });

    // if the schema format is not valid
    if (!isSchemaRequestValid) {
      console.error('response schema format is not valid');
      return false;
    }

    return true;
  };

  // todo fix any type
  public getJSONRPCFormatIsValid = ({ response, schema, prevId }: any) => {
    if (prevId !== response.id) {
      console.error('request-response ids are not equal');
      return false;
    }

    if (!Boolean(response)) {
      console.error('response is empty');
      return false;
    }

    const isFormatValid = this.getIsJSONRPCFormatResponseValid(response);

    // if the base format is not valid
    if (!isFormatValid) {
      console.error('response base format is not valid');
      return false;
    }

    const isSchemaRequestValid = this.getIsSchemaResponseValid({
      data: response.result,
      error: Boolean(response.error),
      schema,
    });

    // if the schema format is not valid
    if (!isSchemaRequestValid) {
      console.error('response schema format is not valid');
      return false;
    }

    return true;
  };

  getFormatValidateMethod = ({
    protocol,
    extraValidationCallback,
  }: GetFormatValidateMethodParams) => {
    // if there is an extra callback for validations
    if (extraValidationCallback) {
      return extraValidationCallback;
    }

    switch (protocol) {
      case requestProtocolsMap.rest:
        return this.getRestFormatIsValid;

      case requestProtocolsMap.jsonRpc:
        return this.getJSONRPCFormatIsValid;

      default:
        return this.getRestFormatIsValid;
    }
  };
}
