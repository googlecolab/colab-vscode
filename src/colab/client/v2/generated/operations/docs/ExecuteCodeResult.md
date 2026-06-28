
# ExecuteCodeResult

The result of an `ExecuteCode` call, returned as the terminal `structured_content` of the response stream.

## Properties

Name | Type
------------ | -------------
`result` | string
`outputTruncated` | boolean
`richOutputsDropped` | boolean
`executionId` | string
`session` | string
`executionCount` | number
`stderr` | string
`executionError` | Error
`stdout` | string

## Example

```typescript
import type { ExecuteCodeResult } from ''

// TODO: Update the object below with actual values
const example = {
  "result": null,
  "outputTruncated": null,
  "richOutputsDropped": null,
  "executionId": null,
  "session": null,
  "executionCount": null,
  "stderr": null,
  "executionError": null,
  "stdout": null,
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


