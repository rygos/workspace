// UI-Shell/Workspace der Anwendung

export class UIShell {
  constructor() {
    console.log('UI Shell initialized.');
  }

  render(): void {
    console.log('Rendering workspace with chat and plugin area.');
  }
}

const shell = new UIShell();
shell.render();
