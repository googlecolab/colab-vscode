# DefaultApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**defaultGetVersion**](DefaultApi.md#defaultgetversion) | **GET** /api/ | Get the Jupyter Server version |



## defaultGetVersion

> DefaultGetVersion200Response defaultGetVersion()

Get the Jupyter Server version

This endpoint returns only the Jupyter Server version. It does not require any authentication. 

### Example

```ts
import {
  Configuration,
  DefaultApi,
} from '';
import type { DefaultGetVersionRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new DefaultApi();

  try {
    const data = await api.defaultGetVersion();
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

[**DefaultGetVersion200Response**](DefaultGetVersion200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Jupyter Server version information |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

