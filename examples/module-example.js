// Sample Akeno Module

const Units = require("akeno:units");

class MyModule extends Units.Module {
    constructor() {
        super({
            name: "My amazing module",
            id: "com.name.example",
            version: "1.0.0"
        })
    }

    doSomething() {
        return "Hi";
    }
}

module.exports = new MyModule();
