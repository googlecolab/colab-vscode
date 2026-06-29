
# ExecuteCodeResult

The result of an `ExecuteCode` call, returned as the terminal `structured_content` of the response stream.

## Properties

Name | Type
------------ | -------------
`stdout` | string
`result` | string
`richOutputsDropped` | boolean
`outputTruncated` | boolean
`stderr` | string
`session` | string
`executionError` | Error
`executionId` | string
`executionCount` | number

## Example

```typescript
import type { ExecuteCodeResult } from ''

// TODO: Update the object below with actual values
const example = {
  "stdout": null,
  "result": null,
  "richOutputsDropped": null,
  "outputTruncated": null,
  "stderr": null,
  "session": null,
  "executionError": null,
  "executionId": null,
  "executionCount": null,
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


