// Stabiler Core der Anwendung (nicht veränderlich)

export class Core {
  constructor() {
    console.log('Core initialized. This is the stable part of the application.');
  }

  start() {
    console.log('Core is running.');
  }
}

const core = new Core();
core.start();
