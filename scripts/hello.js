// hello.js

// Define a constant variable for the greeting using ES6 syntax
const greeting = "JavaScript";

// Define an arrow function that creates a greeting message using a template literal
const createMessage = (name) => {
  return `Hello, ${name}!`;
};

// Output the greeting message to the console
console.log(createMessage(greeting));