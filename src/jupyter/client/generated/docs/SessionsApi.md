# SessionsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**sessionsCreate**](SessionsApi.md#sessionscreate) | **POST** /api/sessions | Create a new session, or return an existing session if a session of the same name already exists |
| [**sessionsDelete**](SessionsApi.md#sessionsdelete) | **DELETE** /api/sessions/{session} | Delete a session |
| [**sessionsGet**](SessionsApi.md#sessionsget) | **GET** /api/sessions/{session} | Get session |
| [**sessionsList**](SessionsApi.md#sessionslist) | **GET** /api/sessions | List available sessions |
| [**sessionsUpdate**](SessionsApi.md#sessionsupdate) | **PATCH** /api/sessions/{session} | This can be used to rename the session. |



## sessionsCreate

> Session sessionsCreate(session)

Create a new session, or return an existing session if a session of the same name already exists

### Example

```ts
import {
  Configuration,
  SessionsApi,
} from '';
import type { SessionsCreateRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new SessionsApi();

  const body = {
    // Session (optional)
    session: ...,
  } satisfies SessionsCreateRequest;

  try {
    const data = await api.sessionsCreate(body);
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
| **session** | [Session](Session.md) |  | [Optional] |

### Return type

[**Session**](Session.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Session created or returned |  * Location - URL for session commands <br>  |
| **501** | Session not available |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sessionsDelete

> sessionsDelete(session)

Delete a session

### Example

```ts
import {
  Configuration,
  SessionsApi,
} from '';
import type { SessionsDeleteRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new SessionsApi();

  const body = {
    // string | session uuid
    session: 38400000-8cf0-11bd-b23e-10b96e4ef00d,
  } satisfies SessionsDeleteRequest;

  try {
    const data = await api.sessionsDelete(body);
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
| **session** | `string` | session uuid | [Defaults to `undefined`] |

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
| **204** | Session (and kernel) were deleted |  -  |
| **410** | Kernel was deleted before the session, and the session was *not* deleted (TODO - check to make sure session wasn\&#39;t deleted) |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sessionsGet

> Session sessionsGet(session)

Get session

### Example

```ts
import {
  Configuration,
  SessionsApi,
} from '';
import type { SessionsGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new SessionsApi();

  const body = {
    // string | session uuid
    session: 38400000-8cf0-11bd-b23e-10b96e4ef00d,
  } satisfies SessionsGetRequest;

  try {
    const data = await api.sessionsGet(body);
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
| **session** | `string` | session uuid | [Defaults to `undefined`] |

### Return type

[**Session**](Session.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Session |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sessionsList

> Array&lt;Session&gt; sessionsList()

List available sessions

### Example

```ts
import {
  Configuration,
  SessionsApi,
} from '';
import type { SessionsListRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new SessionsApi();

  try {
    const data = await api.sessionsList();
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

[**Array&lt;Session&gt;**](Session.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | List of current sessions |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## sessionsUpdate

> Session sessionsUpdate(session, model)

This can be used to rename the session.

### Example

```ts
import {
  Configuration,
  SessionsApi,
} from '';
import type { SessionsUpdateRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new SessionsApi();

  const body = {
    // string | session uuid
    session: 38400000-8cf0-11bd-b23e-10b96e4ef00d,
    // Session
    model: ...,
  } satisfies SessionsUpdateRequest;

  try {
    const data = await api.sessionsUpdate(body);
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
| **session** | `string` | session uuid | [Defaults to `undefined`] |
| **model** | [Session](Session.md) |  | |

### Return type

[**Session**](Session.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Session |  -  |
| **400** | No data provided |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

