
# ExecuteCodeResult

The result of an `ExecuteCode` call, returned as the terminal `structured_content` of the response stream.

## Properties

Name | Type
------------ | -------------
`richOutputsDropped` | boolean
`executionCount` | number
`session` | string
`result` | string
`executionId` | string
`stdout` | string
`outputTruncated` | boolean
`executionError` | Error
`stderr` | string

## Example

```typescript
import type { ExecuteCodeResult } from ''

// TODO: Update the object below with actual values
const example = {
  "richOutputsDropped": null,
  "executionCount": null,
  "session": null,
  "result": null,
  "executionId": null,
  "stdout": null,
  "outputTruncated": null,
  "executionError": null,
  "stderr": null,
} satisfies ExecuteCodeResult

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ExecuteCodeResult
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


