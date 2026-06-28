# ColaboratoryApi

All URIs are relative to *https://colaboratory.googleapis.com*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**cancelOperation**](ColaboratoryApi.md#canceloperation) | **POST** /v1/operations/{operationsId}:cancel |  |
| [**deleteOperation**](ColaboratoryApi.md#deleteoperation) | **DELETE** /v1/operations/{operationsId} |  |
| [**getOperation**](ColaboratoryApi.md#getoperation) | **GET** /v1/operations/{operationsId} |  |
| [**listOperations**](ColaboratoryApi.md#listoperations) | **GET** /v1/operations |  |



## cancelOperation

> object cancelOperation(operationsId, $alt, $callback, $prettyPrint, $xgafv, body)



Starts asynchronous cancellation on a long-running operation.  The server makes a best effort to cancel the operation, but success is not guaranteed.  If the server doesn\&#39;t support this method, it returns &#x60;google.rpc.Code.UNIMPLEMENTED&#x60;.  Clients can use Operations.GetOperation or other methods to check whether the cancellation succeeded or whether the operation completed despite cancellation. On successful cancellation, the operation is not deleted; instead, it becomes an operation with an Operation.error value with a google.rpc.Status.code of &#x60;1&#x60;, corresponding to &#x60;Code.CANCELLED&#x60;.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { CancelOperationRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: bearer_auth
    accessToken: "YOUR BEARER TOKEN",
    // To configure OAuth2 access token for authorization: google_oauth_code accessCode
    accessToken: "YOUR ACCESS TOKEN",
    // To configure OAuth2 access token for authorization: google_oauth_implicit implicit
    accessToken: "YOUR ACCESS TOKEN",
  });
  const api = new ColaboratoryApi(config);

  const body = {
    // string | Part of `name`. The name of the operation resource to be cancelled.
    operationsId: operationsId_example,
    // 'json' | 'media' | 'proto' | Data format for response. (optional)
    $alt: $alt_example,
    // string | JSONP (optional)
    $callback: $callback_example,
    // boolean | Returns response with indentations and line breaks. (optional)
    $prettyPrint: true,
    // '1' | '2' | V1 error format. (optional)
    $xgafv: $xgafv_example,
    // object | The request body. (optional)
    body: Object,
  } satisfies CancelOperationRequest;

  try {
    const data = await api.cancelOperation(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **operationsId** | `string` | Part of &#x60;name&#x60;. The name of the operation resource to be cancelled. | [Defaults to `undefined`] |
| **$alt** | `json`, `media`, `proto` | Data format for response. | [Optional] [Defaults to `&#39;json&#39;`] [Enum: json, media, proto] |
| **$callback** | `string` | JSONP | [Optional] [Defaults to `undefined`] |
| **$prettyPrint** | `boolean` | Returns response with indentations and line breaks. | [Optional] [Defaults to `true`] |
| **$xgafv** | `1`, `2` | V1 error format. | [Optional] [Defaults to `undefined`] [Enum: 1, 2] |
| **body** | `object` | The request body. | [Optional] |

### Return type

**object**

### Authorization

[bearer_auth](../README.md#bearer_auth), [google_oauth_code accessCode](../README.md#google_oauth_code-accessCode), [google_oauth_implicit implicit](../README.md#google_oauth_implicit-implicit)

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **0** | Successful operation |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## deleteOperation

> deleteOperation(operationsId, $alt, $callback, $prettyPrint, $xgafv)



Deletes a long-running operation. This method indicates that the client is no longer interested in the operation result. It does not cancel the operation. If the server doesn\&#39;t support this method, it returns &#x60;google.rpc.Code.UNIMPLEMENTED&#x60;.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { DeleteOperationRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: bearer_auth
    accessToken: "YOUR BEARER TOKEN",
    // To configure OAuth2 access token for authorization: google_oauth_code accessCode
    accessToken: "YOUR ACCESS TOKEN",
    // To configure OAuth2 access token for authorization: google_oauth_implicit implicit
    accessToken: "YOUR ACCESS TOKEN",
  });
  const api = new ColaboratoryApi(config);

  const body = {
    // string | Part of `name`. The name of the operation resource to be deleted.
    operationsId: operationsId_example,
    // 'json' | 'media' | 'proto' | Data format for response. (optional)
    $alt: $alt_example,
    // string | JSONP (optional)
    $callback: $callback_example,
    // boolean | Returns response with indentations and line breaks. (optional)
    $prettyPrint: true,
    // '1' | '2' | V1 error format. (optional)
    $xgafv: $xgafv_example,
  } satisfies DeleteOperationRequest;

  try {
    const data = await api.deleteOperation(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **operationsId** | `string` | Part of &#x60;name&#x60;. The name of the operation resource to be deleted. | [Defaults to `undefined`] |
| **$alt** | `json`, `media`, `proto` | Data format for response. | [Optional] [Defaults to `&#39;json&#39;`] [Enum: json, media, proto] |
| **$callback** | `string` | JSONP | [Optional] [Defaults to `undefined`] |
| **$prettyPrint** | `boolean` | Returns response with indentations and line breaks. | [Optional] [Defaults to `true`] |
| **$xgafv** | `1`, `2` | V1 error format. | [Optional] [Defaults to `undefined`] [Enum: 1, 2] |

### Return type

`void` (Empty response body)

### Authorization

[bearer_auth](../README.md#bearer_auth), [google_oauth_code accessCode](../README.md#google_oauth_code-accessCode), [google_oauth_implicit implicit](../README.md#google_oauth_implicit-implicit)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **0** | Successful operation |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## getOperation

> Operation getOperation(operationsId, $alt, $callback, $prettyPrint, $xgafv)



Gets the latest state of a long-running operation.  Clients can use this method to poll the operation result at intervals as recommended by the API service.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { GetOperationRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: bearer_auth
    accessToken: "YOUR BEARER TOKEN",
    // To configure OAuth2 access token for authorization: google_oauth_code accessCode
    accessToken: "YOUR ACCESS TOKEN",
    // To configure OAuth2 access token for authorization: google_oauth_implicit implicit
    accessToken: "YOUR ACCESS TOKEN",
  });
  const api = new ColaboratoryApi(config);

  const body = {
    // string | Part of `name`. The name of the operation resource.
    operationsId: operationsId_example,
    // 'json' | 'media' | 'proto' | Data format for response. (optional)
    $alt: $alt_example,
    // string | JSONP (optional)
    $callback: $callback_example,
    // boolean | Returns response with indentations and line breaks. (optional)
    $prettyPrint: true,
    // '1' | '2' | V1 error format. (optional)
    $xgafv: $xgafv_example,
  } satisfies GetOperationRequest;

  try {
    const data = await api.getOperation(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **operationsId** | `string` | Part of &#x60;name&#x60;. The name of the operation resource. | [Defaults to `undefined`] |
| **$alt** | `json`, `media`, `proto` | Data format for response. | [Optional] [Defaults to `&#39;json&#39;`] [Enum: json, media, proto] |
| **$callback** | `string` | JSONP | [Optional] [Defaults to `undefined`] |
| **$prettyPrint** | `boolean` | Returns response with indentations and line breaks. | [Optional] [Defaults to `true`] |
| **$xgafv** | `1`, `2` | V1 error format. | [Optional] [Defaults to `undefined`] [Enum: 1, 2] |

### Return type

[**Operation**](Operation.md)

### Authorization

[bearer_auth](../README.md#bearer_auth), [google_oauth_code accessCode](../README.md#google_oauth_code-accessCode), [google_oauth_implicit implicit](../README.md#google_oauth_implicit-implicit)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **0** | Successful operation |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## listOperations

> ListOperationsResponse listOperations($alt, $callback, $prettyPrint, $xgafv, filter, pageSize, pageToken, returnPartialSuccess)



Lists operations that match the specified filter in the request. If the server doesn\&#39;t support this method, it returns &#x60;UNIMPLEMENTED&#x60;.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { ListOperationsRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const config = new Configuration({ 
    // Configure HTTP bearer authorization: bearer_auth
    accessToken: "YOUR BEARER TOKEN",
    // To configure OAuth2 access token for authorization: google_oauth_code accessCode
    accessToken: "YOUR ACCESS TOKEN",
    // To configure OAuth2 access token for authorization: google_oauth_implicit implicit
    accessToken: "YOUR ACCESS TOKEN",
  });
  const api = new ColaboratoryApi(config);

  const body = {
    // 'json' | 'media' | 'proto' | Data format for response. (optional)
    $alt: $alt_example,
    // string | JSONP (optional)
    $callback: $callback_example,
    // boolean | Returns response with indentations and line breaks. (optional)
    $prettyPrint: true,
    // '1' | '2' | V1 error format. (optional)
    $xgafv: $xgafv_example,
    // string | The standard list filter. (optional)
    filter: filter_example,
    // number | The standard list page size. (optional)
    pageSize: 56,
    // string | The standard list page token. (optional)
    pageToken: pageToken_example,
    // boolean | When set to `true`, operations that are reachable are returned as normal, and those that are unreachable are returned in the ListOperationsResponse.unreachable field.  This can only be `true` when reading across collections. For example, when `parent` is set to `\"projects/example/locations/-\"`.  This field is not supported by default and will result in an `UNIMPLEMENTED` error if set unless explicitly documented otherwise in service or product specific documentation. (optional)
    returnPartialSuccess: true,
  } satisfies ListOperationsRequest;

  try {
    const data = await api.listOperations(body);
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters


| Name | Type | Description  | Notes |
|------------- | ------------- | ------------- | -------------|
| **$alt** | `json`, `media`, `proto` | Data format for response. | [Optional] [Defaults to `&#39;json&#39;`] [Enum: json, media, proto] |
| **$callback** | `string` | JSONP | [Optional] [Defaults to `undefined`] |
| **$prettyPrint** | `boolean` | Returns response with indentations and line breaks. | [Optional] [Defaults to `true`] |
| **$xgafv** | `1`, `2` | V1 error format. | [Optional] [Defaults to `undefined`] [Enum: 1, 2] |
| **filter** | `string` | The standard list filter. | [Optional] [Defaults to `undefined`] |
| **pageSize** | `number` | The standard list page size. | [Optional] [Defaults to `undefined`] |
| **pageToken** | `string` | The standard list page token. | [Optional] [Defaults to `undefined`] |
| **returnPartialSuccess** | `boolean` | When set to &#x60;true&#x60;, operations that are reachable are returned as normal, and those that are unreachable are returned in the ListOperationsResponse.unreachable field.  This can only be &#x60;true&#x60; when reading across collections. For example, when &#x60;parent&#x60; is set to &#x60;\&quot;projects/example/locations/-\&quot;&#x60;.  This field is not supported by default and will result in an &#x60;UNIMPLEMENTED&#x60; error if set unless explicitly documented otherwise in service or product specific documentation. | [Optional] [Defaults to `undefined`] |

### Return type

[**ListOperationsResponse**](ListOperationsResponse.md)

### Authorization

[bearer_auth](../README.md#bearer_auth), [google_oauth_code accessCode](../README.md#google_oauth_code-accessCode), [google_oauth_implicit implicit](../README.md#google_oauth_implicit-implicit)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **0** | Successful operation |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

