# KernelsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**kernelsGet**](KernelsApi.md#kernelsget) | **GET** /api/kernels/{kernel_id} | Get kernel information |
| [**kernelsInterrupt**](KernelsApi.md#kernelsinterrupt) | **POST** /api/kernels/{kernel_id}/interrupt | Interrupt a kernel |
| [**kernelsKill**](KernelsApi.md#kernelskill) | **DELETE** /api/kernels/{kernel_id} | Kill a kernel and delete the kernel id |
| [**kernelsList**](KernelsApi.md#kernelslist) | **GET** /api/kernels | List the JSON data for all kernels that are currently running |
| [**kernelsRestart**](KernelsApi.md#kernelsrestart) | **POST** /api/kernels/{kernel_id}/restart | Restart a kernel |
| [**kernelsStart**](KernelsApi.md#kernelsstartoperation) | **POST** /api/kernels | Start a kernel and return the uuid |



## kernelsGet

> Kernel kernelsGet(kernelId)

Get kernel information

### Example

```ts
import {
  Configuration,
  KernelsApi,
} from '';
import type { KernelsGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new KernelsApi();

  const body = {
    // string | kernel uuid
    kernelId: 38400000-8cf0-11bd-b23e-10b96e4ef00d,
  } satisfies KernelsGetRequest;

  try {
    const data = await api.kernelsGet(body);
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
| **kernelId** | `string` | kernel uuid | [Defaults to `undefined`] |

### Return type

[**Kernel**](Kernel.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Kernel information |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## kernelsInterrupt

> kernelsInterrupt(kernelId)

Interrupt a kernel

### Example

```ts
import {
  Configuration,
  KernelsApi,
} from '';
import type { KernelsInterruptRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new KernelsApi();

  const body = {
    // string | kernel uuid
    kernelId: 38400000-8cf0-11bd-b23e-10b96e4ef00d,
  } satisfies KernelsInterruptRequest;

  try {
    const data = await api.kernelsInterrupt(body);
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
| **kernelId** | `string` | kernel uuid | [Defaults to `undefined`] |

### Return type

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **204** | Kernel interrupted |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## kernelsKill

> kernelsKill(kernelId)

Kill a kernel and delete the kernel id

### Example

```ts
import {
  Configuration,
  KernelsApi,
} from '';
import type { KernelsKillRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new KernelsApi();

  const body = {
    // string | kernel uuid
    kernelId: 38400000-8cf0-11bd-b23e-10b96e4ef00d,
  } satisfies KernelsKillRequest;

  try {
    const data = await api.kernelsKill(body);
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
| **kernelId** | `string` | kernel uuid | [Defaults to `undefined`] |

### Return type

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **204** | Kernel deleted |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## kernelsList

> Array&lt;Kernel&gt; kernelsList()

List the JSON data for all kernels that are currently running

### Example

```ts
import {
  Configuration,
  KernelsApi,
} from '';
import type { KernelsListRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new KernelsApi();

  try {
    const data = await api.kernelsList();
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}

// Run the test
example().catch(console.error);
```

### Parameters

This endpoint does not need any parameter.

### Return type

[**Array&lt;Kernel&gt;**](Kernel.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | List of currently-running kernel uuids |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## kernelsRestart

> Kernel kernelsRestart(kernelId)

Restart a kernel

### Example

```ts
import {
  Configuration,
  KernelsApi,
} from '';
import type { KernelsRestartRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new KernelsApi();

  const body = {
    // string | kernel uuid
    kernelId: 38400000-8cf0-11bd-b23e-10b96e4ef00d,
  } satisfies KernelsRestartRequest;

  try {
    const data = await api.kernelsRestart(body);
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
| **kernelId** | `string` | kernel uuid | [Defaults to `undefined`] |

### Return type

[**Kernel**](Kernel.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Kernel restarted |  * Location - URL for kernel commands <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## kernelsStart

> Kernel kernelsStart(options)

Start a kernel and return the uuid

### Example

```ts
import {
  Configuration,
  KernelsApi,
} from '';
import type { KernelsStartOperationRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new KernelsApi();

  const body = {
    // KernelsStartRequest (optional)
    options: ...,
  } satisfies KernelsStartOperationRequest;

  try {
    const data = await api.kernelsStart(body);
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
| **options** | [KernelsStartRequest](KernelsStartRequest.md) |  | [Optional] |

### Return type

[**Kernel**](Kernel.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Kernel started |  * Location - Model for started kernel <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

