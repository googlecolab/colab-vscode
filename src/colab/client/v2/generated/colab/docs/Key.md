
# Key

Key fields that uniquely identify a runtime spec.

## Properties

Name | Type
------------ | -------------
`variant` | [Variant](Variant.md)
`accelerator` | string
`shape` | [Shape](Shape.md)

## Example

```typescript
import type { Key } from ''

// TODO: Update the object below with actual values
const example = {
  "variant": null,
  "accelerator": null,
  "shape": null,
} satisfies Key

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as Key
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


