
# Kernel

Kernel information

## Properties

Name | Type
------------ | -------------
`id` | string
`name` | string
`lastActivity` | string
`connections` | number
`executionState` | string

## Example

```typescript
import type { Kernel } from ''

// TODO: Update the object below with actual values
const example = {
  "id": null,
  "name": null,
  "lastActivity": null,
  "connections": null,
  "executionState": null,
} satisfies Kernel

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as Kernel
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


