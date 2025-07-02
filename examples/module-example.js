

// Sample Akeno Module

const Units = require("@akeno/unit");

module.exports = new class MyModule extends Units.Module {
    constructor() {
        super({
            name: "My amazing module",
            id: "com.yourname.example",
            version: "1.0.0"
        })
    }

    // ...
}