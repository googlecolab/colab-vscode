# KernelspecsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**kernelspecsList**](KernelspecsApi.md#kernelspecslist) | **GET** /api/kernelspecs | Get kernel specs |



## kernelspecsList

> KernelspecsList200Response kernelspecsList()

Get kernel specs

### Example

```ts
import {
  Configuration,
  KernelspecsApi,
} from '';
import type { KernelspecsListRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new KernelspecsApi();

  try {
    const data = await api.kernelspecsList();
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

[**KernelspecsList200Response**](KernelspecsList200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Kernel specs |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

