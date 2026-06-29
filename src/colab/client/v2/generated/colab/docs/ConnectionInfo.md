
# ConnectionInfo

Connection info used to authenticate to the runtime.

## Properties

Name | Type
------------ | -------------
`token` | string
`expireTime` | Date
`url` | string

## Example

```typescript
import type { ConnectionInfo } from ''

// TODO: Update the object below with actual values
const example = {
  "token": null,
  "expireTime": null,
  "url": null,
} satisfies ConnectionInfo

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as ConnectionInfo
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


