import * as WebDriver from "selenium-webdriver";
import chrome from 'selenium-webdriver/chrome';
import * as vscode from "vscode-extension-tester";


async function getClipboardContents(driver: WebDriver.WebDriver): Promise<string | null> {
    try {
        // Check if the clipboard API is available.
        const hasClipboardAPI = await driver.executeScript('return !!navigator.clipboard;');
        if (!hasClipboardAPI) {
            console.warn('Clipboard API is not available in this context.');
            return null;
        }

        const clipboardText: string | null = await driver.executeScript(async () => {
            try {
                return await navigator.clipboard.readText();
            } catch (err) {
                console.error("Error within executeScript:", err);
                return null;
            }
        });
        return clipboardText;
    } catch (error) {
        console.error('Error accessing clipboard:', error);
        return null;
    }
}

/*
Commented out because we copy the Auth URL over. This approach didn't work.

async function setDefaultBrowser(path: string): Promise<void> {
    let settingsEditor = await (new vscode.Workbench().openSettings());
    let setting = await settingsEditor.findSetting("External Browser", "Workbench");
    await setting.setValue(path);
}
*/

// disableNativeOSDialogs - helper to jump into settings and switch dialogs to use 'custom'
// rather than OS specific dialogs. With the OS Specific ones we cannot manipulate them
// under Selenium.
async function disableNativeOSDialogs(): Promise<void> {
    let settingsEditor = await (new vscode.Workbench().openSettings());
    let setting = await settingsEditor.findSetting("Dialog Style", "Window");
    await setting.setValue("custom");
}

describe('Create notebook, auth, and connect to runtime', function (this) {
    this.timeout(15000);

    let chromeDriver: WebDriver.WebDriver;

    before(async () => {

        const chromeOptions = new chrome.Options();
        // Disable headless mode (to see the browser).
        chromeOptions.excludeSwitches('headless');
    
        // Create a Builder instance and configure it for Chrome.
        chromeDriver = await new WebDriver.Builder()
          .forBrowser('chrome')
          .setChromeOptions(chromeOptions)
          .build();
    
        console.log('Chrome browser launched successfully.');

        // Ensure that we don't use native OS dialogs
        await disableNativeOSDialogs();
    });

    after(async () => {
        //await new vscode.EditorView().closeAllEditors();
        await chromeDriver.close();
    });

    it('Create notebook via command prompt', async function () {
        const prompt = await new vscode.Workbench().openCommandPrompt();
        await prompt.setText('> Create: New Jupyter Notebook');
        await prompt.confirm();
        const editorView = new vscode.EditorView();
        const titles = await editorView.getOpenEditorTitles();
        titles.forEach(t => {
            console.log("Editor title: ", t);
        });
        const editor = await editorView.openEditor('Untitled-1.ipynb');
        // TODO: Sometimes the test fails after this step.
        // Error: StaleElementReferenceError: stale element reference: stale element not found in the current frame

        // I haven't found a way to consistently click the 'Select Kernel' or 'Discovering Kernels...'
        // button to let us pick the 'Colab' kernel connection.
        // The first element, 'el', below is findable by '.actions-container'
        // However none of the other classes are findable even though they exist under that one.
        // Additionally, sometimes all that's needed is to open the editorView above to trigger
        // the input-box and/or modal `dialog`

        // kernel-action-view-item
        // actions-container ?
        // kernel-label ?
        // action-label ?
        const el = await editor.getDriver().findElement(WebDriver.By.className("kernel-label"));
        // const el2 = await el.findElement(WebDriver.By.className("action-label"));
        await el.click();

        // Select the 'Colab' kernel backend.
        const input = new vscode.InputBox;
        const item = await input.findQuickPick("Colab");
        await item?.click();

        const input2 = new vscode.InputBox;

        // TODO: This dialog has an extra space at the beginning which should be removed.
        const newServer = await input2.findQuickPick(" New Colab Server");
        await newServer?.click();

        // First modal dialog asks to connect to collab.
        const dialog = new vscode.ModalDialog();
        const details = await dialog.getDetails();
        // message here is not set.
        console.log("Modal dialog with details: ", details)
        // get the button web elements
        await dialog.pushButton("Allow");

        // Second dialog asks whether to Open URL or do something else.
        // Here we copy the URL to our chromeDriver Selenium WebDriver.
        const dialog2 = new vscode.ModalDialog();
        console.log("Modal dialog with message: ", await dialog2.getMessage());
        console.log("Modal dialog with details: ", await dialog2.getDetails());
        // Options: Open, Copy, Cancel, Configure Trusted Domains
        await dialog2.pushButton("Copy");
        // Clipboard not available on default open page.
        await chromeDriver.get('chrome://new-tab-page');
        // Get the clipboard contents.
        const clipboardData = await getClipboardContents(chromeDriver);
    
        if (clipboardData !== null) {
            console.log('Clipboard contents:', clipboardData);
        } else {
            console.log('Failed to retrieve clipboard contents.');
        }
        if (clipboardData) {
            const emailNextButton = WebDriver.By.id("identifierNext");
            const passwordNextButton = WebDriver.By.id("passwordNext");
            await chromeDriver.navigate().to(clipboardData);
            await chromeDriver.takeScreenshot();
            await chromeDriver.wait(WebDriver.until.elementLocated(emailNextButton));
            const emailInput = await chromeDriver.findElement(WebDriver.By.className("whsOnd zHQkBf"));
            await emailInput.sendKeys("datalabprobervscode@gmail.com");
            // await emailInput.submit(); // This doesn't work for some reason.
            // Press the 'Next'
            await (await chromeDriver.findElement(emailNextButton)).click();


            await chromeDriver.wait(WebDriver.until.elementLocated(passwordNextButton));
            const passwordInput = await chromeDriver.findElement(WebDriver.By.className("whsOnd zHQkBf"));
            await passwordInput.sendKeys("correct password here");
            // await passwordInput.submit();
            await (await chromeDriver.findElement(passwordNextButton)).click();
            console.log("Logged in!");
        }
        await vscode.VSBrowser.instance.takeScreenshot("after_login");
        await chromeDriver.takeScreenshot();
    });
});

/*
// openClipboardInSimpleBrowser launches the built-in VS Code simple browser,
// it opens the URL contained in the clipboard.
// This returns an error from accounts.google.com with - go/framing-isolation-policy.
// To continue with this approach we would need to address that which seems difficult.
async function openClipboardInSimpleBrowser(bench: vscode.Workbench): Promise<void> {
    // open the browser
    const commandPrompt = await bench.openCommandPrompt();
    await commandPrompt.setText('> Simple Browser: Show')
    await commandPrompt.confirm();
    // get the browser input box
    const box = await vscode.InputBox.create();
    // send COMMAND+v, ENTER to paste from clipboard
    // TODO: handle CTL vs COMMAND
    const action = box.getDriver().actions();
    action.keyDown(WebDriver.Key.COMMAND);
    action.sendKeys('v');
    action.sendKeys(WebDriver.Key.ENTER);
    await action.perform();
}
*/
