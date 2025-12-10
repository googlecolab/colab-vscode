# IdentityApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**identityGet**](IdentityApi.md#identityget) | **GET** /api/me | Get the identity of the currently authenticated user. If present, a &#x60;permissions&#x60; argument may be specified to check what actions the user currently is authorized to take.  |



## identityGet

> IdentityGet200Response identityGet(permissions)

Get the identity of the currently authenticated user. If present, a &#x60;permissions&#x60; argument may be specified to check what actions the user currently is authorized to take. 

### Example

```ts
import {
  Configuration,
  IdentityApi,
} from '';
import type { IdentityGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new IdentityApi();

  const body = {
    // string | JSON-serialized dictionary of `{\"resource\": [\"action\",]}` (dict of lists of strings) to check. The same dictionary structure will be returned, containing only the actions for which the user is authorized.  (optional)
    permissions: permissions_example,
  } satisfies IdentityGetRequest;

  try {
    const data = await api.identityGet(body);
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
| **permissions** | `string` | JSON-serialized dictionary of &#x60;{\&quot;resource\&quot;: [\&quot;action\&quot;,]}&#x60; (dict of lists of strings) to check. The same dictionary structure will be returned, containing only the actions for which the user is authorized.  | [Optional] [Defaults to `undefined`] |

### Return type

[**IdentityGet200Response**](IdentityGet200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | The user\&#39;s identity and permissions |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

