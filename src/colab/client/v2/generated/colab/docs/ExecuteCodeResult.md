
# ExecuteCodeResult

The result of an `ExecuteCode` call, returned as the terminal `structured_content` of the response stream.

## Properties

Name | Type
------------ | -------------
`outputTruncated` | boolean
`stderr` | string
`executionId` | string
`session` | string
`executionCount` | number
`stdout` | string
`executionError` | Error
`result` | string
`richOutputsDropped` | boolean

## Example

```typescript
import type { ExecuteCodeResult } from ''

// TODO: Update the object below with actual values
const example = {
  "outputTruncated": null,
  "stderr": null,
  "executionId": null,
  "session": null,
  "executionCount": null,
  "stdout": null,
  "executionError": null,
  "result": null,
  "richOutputsDropped": null,
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


