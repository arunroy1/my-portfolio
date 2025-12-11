const displayEl     = document.getElementById('display');
const calculationEl = document.getElementById('calculation');
const mcBtn         = document.getElementById('mc');
let expression = '';
let memory     = 0;

render();
updateMemoryIndicator();

// Attach click listeners to every button
document
  .querySelectorAll('#calculator button')
  .forEach(btn => btn.addEventListener('click', () => handleInput(btn.value)));

// Keyboard support
document.addEventListener('keydown', e => {
  const k = e.key;
  if (/\d/.test(k) || ['+','-','*','/','.','%'].includes(k)) {
    handleInput(k);
  } else if (k === 'Enter') {
    e.preventDefault();
    handleInput('=');
  } else if (k === 'Backspace') {
    handleInput('back');
  } else if (k === 'Escape') {
    handleInput('AC');
  }
});

function handleInput(value) {
  switch (value) {
    case 'AC':
      expression = '';
      render();
      break;

    case '+/-':
      if (expression) {
        expression = String( secureEval(expression) * -1 );
        render();
      }
      break;

    case '%':
      if (expression) {
        expression = String( secureEval(expression) / 100 );
        render();
      }
      break;

    case '=':
      calculate();
      break;

    case 'back':
      expression = expression.slice(0, -1);
      render();
      break;

    // *** Memory Operations ***
    case 'MC':
      memory = 0;
      updateMemoryIndicator();
      break;

    case 'MR':
      // recall into both displays
      expression = String(memory);
      render();
      break;

    case 'M+':
      if (expression) {
        // evaluate whatever's on screen
        const val = secureEval(expression);
        memory += val;
        updateMemoryIndicator();
        // keep the result on screen so next M+ uses it
        expression = String(val);
        render();
      }
      break;

    case 'M-':
      if (expression) {
        const val = secureEval(expression);
        memory -= val;
        updateMemoryIndicator();
        expression = String(val);
        render();
      }
      break;

    default:
      // any number/operator just appends
      expression += value;
      render();
  }
}

function render() {
  calculationEl.value = expression;  // top line always shows the raw expression
  displayEl.value     = expression;  // big display mirrors until "="
}

function calculate() {
  try {
    calculationEl.value = expression;       // lock expression at top
    const result = secureEval(expression);
    displayEl.value = result;               // show result big
    expression = String(result);            // let further calc continue
  } catch {
    displayEl.value = 'Error';
    expression = '';
  }
}

function secureEval(expr) {
  const safe = /^[0-9+\-*/%.() ]+$/;
  if (!safe.test(expr)) throw new Error('Invalid characters');
  return Function('"use strict";return(' + expr + ')')();
}

function updateMemoryIndicator() {
  mcBtn.classList.toggle('active', memory !== 0);
}