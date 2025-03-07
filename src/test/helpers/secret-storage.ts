import sinon, { SinonStubbedInstance } from "sinon";
import { SecretStorage } from "vscode";

/**
 * A thin fake implementation backed by stubs of `SecretStorage` that stores
 * the last value so it can be retrieved on subsequent requests.
 *
 * Methods are stubbed to facilitate test assertions.
 */
export class SecretStorageFake
  implements
    SinonStubbedInstance<Pick<SecretStorage, "get" | "store" | "delete">>
{
  private lastStore?: string;

  get = sinon
    .stub<[key: string], Thenable<string | undefined>>()
    .callsFake(() => Promise.resolve(this.lastStore));
  store = sinon
    .stub<[key: string, value: string], Thenable<void>>()
    .callsFake((_, value: string) => {
      this.lastStore = value;
      return Promise.resolve();
    });
  delete = sinon.stub<[key: string], Thenable<void>>().callsFake(() => {
    this.lastStore = undefined;
    return Promise.resolve();
  });
}
