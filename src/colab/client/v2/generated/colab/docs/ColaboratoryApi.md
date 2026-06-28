# ColaboratoryApi

All URIs are relative to *https://colaboratory.googleapis.com*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**createRuntime**](ColaboratoryApi.md#createruntime) | **POST** /v1beta/runtimes |  |
| [**deleteRuntime**](ColaboratoryApi.md#deleteruntime) | **DELETE** /v1beta/runtimes/{runtime} |  |
| [**getRuntime**](ColaboratoryApi.md#getruntime) | **GET** /v1beta/runtimes/{runtime} |  |
| [**getSubscription**](ColaboratoryApi.md#getsubscription) | **GET** /v1beta/subscription |  |
| [**listRuntimeSpecs**](ColaboratoryApi.md#listruntimespecs) | **GET** /v1beta/runtimespecs |  |
| [**listRuntimes**](ColaboratoryApi.md#listruntimes) | **GET** /v1beta/runtimes |  |



## createRuntime

> CreateRuntimeOperation createRuntime($alt, $callback, $prettyPrint, $xgafv, requestId, runtimeId, runtime)



Creates a Colab runtime assignment.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { CreateRuntimeRequest } from '';

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
    // string | Optional. A unique identifier for this request.  This request is only idempotent if a `request_id` is provided. See https://google.aip.dev/155 for more details.  If provided, the request ID must be in UUID4 format per https://linter.aip.dev/155/request-id-format. (optional)
    requestId: requestId_example,
    // string | Optional. A unique identifier for the runtime. If not supplied, a random UUID will be generated. If a runtime with the given ID owned by the requesting user already exists, a completed Operation with an ALREADY_EXISTS error will be returned. See https://google.aip.dev/133#user-specified-ids for more details.  The ID must conform to https://datatracker.ietf.org/doc/html/rfc1034, specifically: - 1 to 63 characters - Lower-case letters, digits, and hyphens - Start with a letter - End with a letter or digit (optional)
    runtimeId: runtimeId_example,
    // Runtime | Required. Specifications for the runtime to assign. (optional)
    runtime: ...,
  } satisfies CreateRuntimeRequest;

  try {
    const data = await api.createRuntime(body);
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
| **requestId** | `string` | Optional. A unique identifier for this request.  This request is only idempotent if a &#x60;request_id&#x60; is provided. See https://google.aip.dev/155 for more details.  If provided, the request ID must be in UUID4 format per https://linter.aip.dev/155/request-id-format. | [Optional] [Defaults to `undefined`] |
| **runtimeId** | `string` | Optional. A unique identifier for the runtime. If not supplied, a random UUID will be generated. If a runtime with the given ID owned by the requesting user already exists, a completed Operation with an ALREADY_EXISTS error will be returned. See https://google.aip.dev/133#user-specified-ids for more details.  The ID must conform to https://datatracker.ietf.org/doc/html/rfc1034, specifically: - 1 to 63 characters - Lower-case letters, digits, and hyphens - Start with a letter - End with a letter or digit | [Optional] [Defaults to `undefined`] |
| **runtime** | [Runtime](Runtime.md) | Required. Specifications for the runtime to assign. | [Optional] |

### Return type

[**CreateRuntimeOperation**](CreateRuntimeOperation.md)

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


## deleteRuntime

> deleteRuntime(runtime, $alt, $callback, $prettyPrint, $xgafv)



Deletes a Colab runtime assignment.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { DeleteRuntimeRequest } from '';

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
    // string | Resource ID segment making up resource `name`. It identifies the resource within its parent collection as described in https://google.aip.dev/122.
    runtime: runtime_example,
    // 'json' | 'media' | 'proto' | Data format for response. (optional)
    $alt: $alt_example,
    // string | JSONP (optional)
    $callback: $callback_example,
    // boolean | Returns response with indentations and line breaks. (optional)
    $prettyPrint: true,
    // '1' | '2' | V1 error format. (optional)
    $xgafv: $xgafv_example,
  } satisfies DeleteRuntimeRequest;

  try {
    const data = await api.deleteRuntime(body);
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
| **runtime** | `string` | Resource ID segment making up resource &#x60;name&#x60;. It identifies the resource within its parent collection as described in https://google.aip.dev/122. | [Defaults to `undefined`] |
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


## getRuntime

> Runtime getRuntime(runtime, $alt, $callback, $prettyPrint, $xgafv)



Gets a Colab runtime assigned to the requesting user.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { GetRuntimeRequest } from '';

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
    // string | Resource ID segment making up resource `name`. It identifies the resource within its parent collection as described in https://google.aip.dev/122.
    runtime: runtime_example,
    // 'json' | 'media' | 'proto' | Data format for response. (optional)
    $alt: $alt_example,
    // string | JSONP (optional)
    $callback: $callback_example,
    // boolean | Returns response with indentations and line breaks. (optional)
    $prettyPrint: true,
    // '1' | '2' | V1 error format. (optional)
    $xgafv: $xgafv_example,
  } satisfies GetRuntimeRequest;

  try {
    const data = await api.getRuntime(body);
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
| **runtime** | `string` | Resource ID segment making up resource &#x60;name&#x60;. It identifies the resource within its parent collection as described in https://google.aip.dev/122. | [Defaults to `undefined`] |
| **$alt** | `json`, `media`, `proto` | Data format for response. | [Optional] [Defaults to `&#39;json&#39;`] [Enum: json, media, proto] |
| **$callback** | `string` | JSONP | [Optional] [Defaults to `undefined`] |
| **$prettyPrint** | `boolean` | Returns response with indentations and line breaks. | [Optional] [Defaults to `true`] |
| **$xgafv** | `1`, `2` | V1 error format. | [Optional] [Defaults to `undefined`] [Enum: 1, 2] |

### Return type

[**Runtime**](Runtime.md)

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


## getSubscription

> Subscription getSubscription($alt, $callback, $prettyPrint, $xgafv)



Gets the subscription of the requesting user.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { GetSubscriptionRequest } from '';

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
  } satisfies GetSubscriptionRequest;

  try {
    const data = await api.getSubscription(body);
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

### Return type

[**Subscription**](Subscription.md)

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


## listRuntimeSpecs

> ListRuntimeSpecsResponse listRuntimeSpecs($alt, $callback, $prettyPrint, $xgafv)



Lists Colab runtime specs available to the requesting user.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { ListRuntimeSpecsRequest } from '';

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
  } satisfies ListRuntimeSpecsRequest;

  try {
    const data = await api.listRuntimeSpecs(body);
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

### Return type

[**ListRuntimeSpecsResponse**](ListRuntimeSpecsResponse.md)

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


## listRuntimes

> ListRuntimesResponse listRuntimes($alt, $callback, $prettyPrint, $xgafv)



Lists Colab runtimes assigned to the requesting user.

### Example

```ts
import {
  Configuration,
  ColaboratoryApi,
} from '';
import type { ListRuntimesRequest } from '';

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
  } satisfies ListRuntimesRequest;

  try {
    const data = await api.listRuntimes(body);
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

### Return type

[**ListRuntimesResponse**](ListRuntimesResponse.md)

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

