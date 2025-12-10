# TerminalsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**terminalsCreate**](TerminalsApi.md#terminalscreate) | **POST** /api/terminals | Create a new terminal |
| [**terminalsDelete**](TerminalsApi.md#terminalsdelete) | **DELETE** /api/terminals/{terminal_id} | Delete a terminal session corresponding to an id. |
| [**terminalsGet**](TerminalsApi.md#terminalsget) | **GET** /api/terminals/{terminal_id} | Get a terminal session corresponding to an id. |
| [**terminalsList**](TerminalsApi.md#terminalslist) | **GET** /api/terminals | Get available terminals |



## terminalsCreate

> Terminal terminalsCreate()

Create a new terminal

### Example

```ts
import {
  Configuration,
  TerminalsApi,
} from '';
import type { TerminalsCreateRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new TerminalsApi();

  try {
    const data = await api.terminalsCreate();
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

[**Terminal**](Terminal.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Successfully created a new terminal |  -  |
| **403** | Forbidden to access |  -  |
| **404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## terminalsDelete

> terminalsDelete(terminalId)

Delete a terminal session corresponding to an id.

### Example

```ts
import {
  Configuration,
  TerminalsApi,
} from '';
import type { TerminalsDeleteRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new TerminalsApi();

  const body = {
    // string | ID of terminal session
    terminalId: terminalId_example,
  } satisfies TerminalsDeleteRequest;

  try {
    const data = await api.terminalsDelete(body);
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
| **terminalId** | `string` | ID of terminal session | [Defaults to `undefined`] |

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
| **204** | Successfully deleted terminal session |  -  |
| **403** | Forbidden to access |  -  |
| **404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## terminalsGet

> Terminal terminalsGet(terminalId)

Get a terminal session corresponding to an id.

### Example

```ts
import {
  Configuration,
  TerminalsApi,
} from '';
import type { TerminalsGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new TerminalsApi();

  const body = {
    // string | ID of terminal session
    terminalId: terminalId_example,
  } satisfies TerminalsGetRequest;

  try {
    const data = await api.terminalsGet(body);
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
| **terminalId** | `string` | ID of terminal session | [Defaults to `undefined`] |

### Return type

[**Terminal**](Terminal.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Terminal session with given id |  -  |
| **403** | Forbidden to access |  -  |
| **404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## terminalsList

> Array&lt;Terminal&gt; terminalsList()

Get available terminals

### Example

```ts
import {
  Configuration,
  TerminalsApi,
} from '';
import type { TerminalsListRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new TerminalsApi();

  try {
    const data = await api.terminalsList();
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

[**Array&lt;Terminal&gt;**](Terminal.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | A list of all available terminal ids. |  -  |
| **403** | Forbidden to access |  -  |
| **404** | Not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

