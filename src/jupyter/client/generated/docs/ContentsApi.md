# ContentsApi

All URIs are relative to *http://localhost*

| Method | HTTP request | Description |
|------------- | ------------- | -------------|
| [**contentsCreate**](ContentsApi.md#contentscreateoperation) | **POST** /api/contents/{path} | Create a new file in the specified path |
| [**contentsCreateCheckpoint**](ContentsApi.md#contentscreatecheckpoint) | **POST** /api/contents/{path}/checkpoints | Create a new checkpoint for a file |
| [**contentsDelete**](ContentsApi.md#contentsdelete) | **DELETE** /api/contents/{path} | Delete a file in the given path |
| [**contentsDeleteCheckpoint**](ContentsApi.md#contentsdeletecheckpoint) | **DELETE** /api/contents/{path}/checkpoints/{checkpoint_id} | Delete a checkpoint |
| [**contentsGet**](ContentsApi.md#contentsget) | **GET** /api/contents/{path} | Get contents of file or directory |
| [**contentsListCheckpoints**](ContentsApi.md#contentslistcheckpoints) | **GET** /api/contents/{path}/checkpoints | Get a list of checkpoints for a file |
| [**contentsRename**](ContentsApi.md#contentsrenameoperation) | **PATCH** /api/contents/{path} | Rename a file or directory without re-uploading content |
| [**contentsRestoreCheckpoint**](ContentsApi.md#contentsrestorecheckpoint) | **POST** /api/contents/{path}/checkpoints/{checkpoint_id} | Restore a file to a particular checkpointed state |
| [**contentsSave**](ContentsApi.md#contentssaveoperation) | **PUT** /api/contents/{path} | Save or upload file. |



## contentsCreate

> Contents contentsCreate(path, model)

Create a new file in the specified path

A POST to /api/contents/path creates a New untitled, empty file or directory. A POST to /api/contents/path with body {\&#39;copy_from\&#39;: \&#39;/path/to/OtherNotebook.ipynb\&#39;} creates a new copy of OtherNotebook in path.

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsCreateOperationRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
    // ContentsCreateRequest | Path of file to copy (optional)
    model: ...,
  } satisfies ContentsCreateOperationRequest;

  try {
    const data = await api.contentsCreate(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |
| **model** | [ContentsCreateRequest](ContentsCreateRequest.md) | Path of file to copy | [Optional] |

### Return type

[**Contents**](Contents.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | File created |  * Location - URL for the new file <br>  |
| **400** | Bad request |  -  |
| **404** | No item found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## contentsCreateCheckpoint

> Checkpoints contentsCreateCheckpoint(path)

Create a new checkpoint for a file

Create a new checkpoint with the current state of a file. With the default FileContentsManager, only one checkpoint is supported, so creating new checkpoints clobbers existing ones.

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsCreateCheckpointRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
  } satisfies ContentsCreateCheckpointRequest;

  try {
    const data = await api.contentsCreateCheckpoint(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |

### Return type

[**Checkpoints**](Checkpoints.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **201** | Checkpoint created |  * Location - URL for the checkpoint <br>  |
| **400** | Bad request |  -  |
| **404** | No item found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## contentsDelete

> contentsDelete(path)

Delete a file in the given path

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsDeleteRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
  } satisfies ContentsDeleteRequest;

  try {
    const data = await api.contentsDelete(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |

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
| **204** | File deleted |  * Location - URL for the removed file <br>  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## contentsDeleteCheckpoint

> contentsDeleteCheckpoint(path, checkpointId)

Delete a checkpoint

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsDeleteCheckpointRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
    // string | Checkpoint id for a file
    checkpointId: checkpointId_example,
  } satisfies ContentsDeleteCheckpointRequest;

  try {
    const data = await api.contentsDeleteCheckpoint(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |
| **checkpointId** | `string` | Checkpoint id for a file | [Defaults to `undefined`] |

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
| **204** | Checkpoint deleted |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## contentsGet

> Contents contentsGet(path, type, format, content, hash)

Get contents of file or directory

A client can optionally specify a type and/or format argument via URL parameter. When given, the Contents service shall return a model in the requested type and/or format. If the request cannot be satisfied, e.g. type&#x3D;text is requested, but the file is binary, then the request shall fail with 400 and have a JSON response containing a \&#39;reason\&#39; field, with the value \&#39;bad format\&#39; or \&#39;bad type\&#39;, depending on what was requested.

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsGetRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
    // 'file' | 'directory' | File type (\'file\', \'directory\') (optional)
    type: type_example,
    // 'text' | 'base64' | How file content should be returned (\'text\', \'base64\') (optional)
    format: format_example,
    // number | Return content (0 for no content, 1 for return content) (optional)
    content: 56,
    // number | May return hash hexdigest string of content and the hash algorithm (0 for no hash - default, 1 for return hash). It may be ignored by the content manager. (optional)
    hash: 56,
  } satisfies ContentsGetRequest;

  try {
    const data = await api.contentsGet(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |
| **type** | `file`, `directory` | File type (\&#39;file\&#39;, \&#39;directory\&#39;) | [Optional] [Defaults to `undefined`] [Enum: file, directory] |
| **format** | `text`, `base64` | How file content should be returned (\&#39;text\&#39;, \&#39;base64\&#39;) | [Optional] [Defaults to `undefined`] [Enum: text, base64] |
| **content** | `number` | Return content (0 for no content, 1 for return content) | [Optional] [Defaults to `undefined`] |
| **hash** | `number` | May return hash hexdigest string of content and the hash algorithm (0 for no hash - default, 1 for return hash). It may be ignored by the content manager. | [Optional] [Defaults to `undefined`] |

### Return type

[**Contents**](Contents.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Contents of file or directory |  * Last-Modified - Last modified date for file <br>  |
| **400** | Bad request |  -  |
| **404** | No item found |  -  |
| **500** | Model key error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## contentsListCheckpoints

> Array&lt;Checkpoints&gt; contentsListCheckpoints(path)

Get a list of checkpoints for a file

List checkpoints for a given file. There will typically be zero or one results.

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsListCheckpointsRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
  } satisfies ContentsListCheckpointsRequest;

  try {
    const data = await api.contentsListCheckpoints(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |

### Return type

[**Array&lt;Checkpoints&gt;**](Checkpoints.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | List of checkpoints for a file |  -  |
| **400** | Bad request |  -  |
| **404** | No item found |  -  |
| **500** | Model key error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## contentsRename

> Contents contentsRename(path, rename)

Rename a file or directory without re-uploading content

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsRenameOperationRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
    // ContentsRenameRequest | New path for file or directory.
    rename: ...,
  } satisfies ContentsRenameOperationRequest;

  try {
    const data = await api.contentsRename(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |
| **rename** | [ContentsRenameRequest](ContentsRenameRequest.md) | New path for file or directory. | |

### Return type

[**Contents**](Contents.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | Path updated |  * Location - Updated URL for the file or directory <br>  |
| **400** | No data provided |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## contentsRestoreCheckpoint

> contentsRestoreCheckpoint(path, checkpointId)

Restore a file to a particular checkpointed state

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsRestoreCheckpointRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
    // string | Checkpoint id for a file
    checkpointId: checkpointId_example,
  } satisfies ContentsRestoreCheckpointRequest;

  try {
    const data = await api.contentsRestoreCheckpoint(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |
| **checkpointId** | `string` | Checkpoint id for a file | [Defaults to `undefined`] |

### Return type

`void` (Empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **204** | Checkpoint restored |  -  |
| **400** | Bad request |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


## contentsSave

> Contents contentsSave(path, model)

Save or upload file.

Saves the file in the location specified by name and path.  PUT is very similar to POST, but the requester specifies the name, whereas with POST, the server picks the name.

### Example

```ts
import {
  Configuration,
  ContentsApi,
} from '';
import type { ContentsSaveOperationRequest } from '';

async function example() {
  console.log("🚀 Testing  SDK...");
  const api = new ContentsApi();

  const body = {
    // string | file path
    path: path_example,
    // ContentsSaveRequest | New path for file or directory (optional)
    model: ...,
  } satisfies ContentsSaveOperationRequest;

  try {
    const data = await api.contentsSave(body);
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
| **path** | `string` | file path | [Defaults to `undefined`] |
| **model** | [ContentsSaveRequest](ContentsSaveRequest.md) | New path for file or directory | [Optional] |

### Return type

[**Contents**](Contents.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: `application/json`
- **Accept**: `application/json`


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
| **200** | File saved |  * Location - Updated URL for the file or directory <br>  |
| **201** | Path created |  * Location - URL for the file or directory <br>  |
| **400** | No data provided |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)

