
# KernelSpecFile

Kernel spec json file

## Properties

Name | Type
------------ | -------------
`language` | string
`argv` | Array&lt;string&gt;
`displayName` | string
`codemirrorMode` | string
`env` | { [key: string]: string; }
`helpLinks` | [Array&lt;KernelSpecFileHelpLinksInner&gt;](KernelSpecFileHelpLinksInner.md)

## Example

```typescript
import type { KernelSpecFile } from ''

// TODO: Update the object below with actual values
const example = {
  "language": null,
  "argv": null,
  "displayName": null,
  "codemirrorMode": null,
  "env": null,
  "helpLinks": null,
} satisfies KernelSpecFile

console.log(example)

// Convert the instance to a JSON string
const exampleJSON: string = JSON.stringify(example)
console.log(exampleJSON)

// Parse the JSON string back to an object
const exampleParsed = JSON.parse(exampleJSON) as KernelSpecFile
console.log(exampleParsed)
```

[[Back to top]](#) [[Back to API list]](../README.md#api-endpoints) [[Back to Model list]](../README.md#models) [[Back to README]](../README.md)


