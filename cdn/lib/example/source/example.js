


/*

    Multiline comments starting with "]" will be parsed with a special language
    that allows you to easily implement tree shaking and more cool features to your libaries!

*/



/*]

#( For example, you can set variables: )

set(myVariable :: myValue)

#( Now you can use $myVariable! )

echo(console.log('This will be included in the source code!'))

# ( You can also use import to import other files dynamically and more! )





# ( For three-shaking: )
# ( You can mark parts with this syntax: )

part (myPart) {
    # ( Content inside a part will be only included when its added to the list by the user! )
}

default {
    # ( Content inside 'default' will be included by default )
}

*/


console.log("Default code");


/*] part(examplePart) { */

console.log("This code will only be included if the url contains [examplePart] or [*]!");

/*] } */