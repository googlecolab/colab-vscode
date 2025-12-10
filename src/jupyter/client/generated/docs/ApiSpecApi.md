# ApiSpecApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**apiSpecGet**](ApiSpecApi.md#apispecget) | **GET** /api/spec.yaml | Get the current spec for the notebook server\&#39;s APIs. |



## apiSpecGet

> Blob apiSpecGet()

Get the current spec for the notebook server\&#39;s APIs.

### Example

```ts
import {
  Configuration,
  ApiSpecApi,
} from '';
import type { ApiSpecGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ApiSpecApi();

  try {
    const data = await api.apiSpecGet();
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

**Blob**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `text/x-yaml`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | The current spec for the notebook server\&#39;s APIs. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

