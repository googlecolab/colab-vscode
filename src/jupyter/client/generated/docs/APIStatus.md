
# APIStatus

Notebook server API status. Added in notebook 5.0. 

## Properties

Name | Type
------------ | -------------
`started` | string
`lastActivity` | string
`connections` | number
`kernels` | number

## Example

```typescript
import type { APIStatus } from ''

// TODO: Update the object below with actual values
const example = {
  "started": null,
  "lastActivity": null,
  "connections": null,
  "kernels": null,
} satisfies APIStatus

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as APIStatus
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


