# ConfigApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**configGet**](ConfigApi.md#configget) | **GET** /api/config/{section_name} | Get a configuration section by name |
| [**configUpdate**](ConfigApi.md#configupdate) | **PATCH** /api/config/{section_name} | Update a configuration section by name |



## configGet

> object configGet(sectionName)

Get a configuration section by name

### Example

```ts
import {
  Configuration,
  ConfigApi,
} from '';
import type { ConfigGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ConfigApi();

  const body = {
    // string | Name of config section
    sectionName: sectionName_example,
  } satisfies ConfigGetRequest;

  try {
    const data = await api.configGet(body);
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
| **sectionName** | `string` | Name of config section | [Defaults to `undefined`] |

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Configuration object |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## configUpdate

> object configUpdate(sectionName, _configuration)

Update a configuration section by name

### Example

```ts
import {
  Configuration,
  ConfigApi,
} from '';
import type { ConfigUpdateRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ConfigApi();

  const body = {
    // string | Name of config section
    sectionName: sectionName_example,
    // object (optional)
    _configuration: Object,
  } satisfies ConfigUpdateRequest;

  try {
    const data = await api.configUpdate(body);
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
| **sectionName** | `string` | Name of config section | [Defaults to `undefined`] |
| **_configuration** | `object` |  | [Optional] |

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Configuration object |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

