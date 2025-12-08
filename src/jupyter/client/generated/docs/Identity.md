
# Identity

The identity of the currently authenticated user

## Properties

Name | Type
------------ | -------------
`username` | string
`name` | string
`displayName` | string
`initials` | string
`avatarUrl` | string
`color` | string

## Example

```typescript
import type { Identity } from ''

// TODO: Update the object below with actual values
const example = {
  "username": null,
  "name": null,
  "displayName": null,
  "initials": null,
  "avatarUrl": null,
  "color": null,
} satisfies Identity

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as Identity
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


