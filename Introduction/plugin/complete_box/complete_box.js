var captionLength = 0;
var caption = '';
var writingVelocity = 500; // milliseconds per character (1 seconds/character)
var currentBoxIndex = 0; // Track which box to animate next
var orderedBoxes = []; // Will store boxes sorted by their order attribute
const audio_src= new Audio("https://cdn.pixabay.com/download/audio/2022/03/10/audio_7eef141153.mp3?filename=chalk-on-chalkboard-32542.mp3")
const boxes = document.getElementsByClassName("atb");

const boxpressed = e => {
    // Get original text from data attribute
    caption = e.target.getAttribute('data-original-text') || e.target.textContent;
    
    // If caption is empty or already animated, skip
    if (!caption || caption.trim() === '' || e.target.hasAttribute('data-animated')) {
        return;
    }
    
    // Mark this box as animated
    e.target.setAttribute('data-animated', 'true');
    
    // Update currentBoxIndex to skip this box when using 'w' key
    const boxIndex = orderedBoxes.indexOf(e.target);
    if (boxIndex !== -1 && boxIndex >= currentBoxIndex) {
        currentBoxIndex = boxIndex + 1;
    }
    
    audio_src.play()
    audio_src.volume=.25
    widthEl=getComputedStyle(e.target).width;
    heightEl=getComputedStyle(e.target).height;
    e.target.textContent="";//clean box      
    e.target.style.width=widthEl;
    e.target.style.height=heightEl ;   
    e.target.style.color = "#990000";  // changes color of font     
    typeSentence(caption,e.target,writingVelocity); 
    

  };

// Initialize ordered boxes array and sort by data-order attribute
// Store original text for all boxes FIRST
for (let box of boxes) {
    box.setAttribute('data-original-text', box.textContent);
    box.addEventListener("click", boxpressed);
};

// Only include boxes that have a data-order attribute, then sort them
orderedBoxes = Array.from(boxes)
    .filter(box => box.hasAttribute('data-order'))
    .sort((a, b) => {
        const orderA = parseInt(a.getAttribute('data-order'));
        const orderB = parseInt(b.getAttribute('data-order'));
        return orderA - orderB;
    });

// Keyboard event listener for 'w' key
document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === 'w') {
        // Find the next non-animated box
        while (currentBoxIndex < orderedBoxes.length && 
               orderedBoxes[currentBoxIndex].hasAttribute('data-animated')) {
            currentBoxIndex++;
        }
        
        if (currentBoxIndex < orderedBoxes.length) {
            const nextBox = orderedBoxes[currentBoxIndex];
            
            // Create a synthetic event object
            const syntheticEvent = {
                target: nextBox
            };
            boxpressed(syntheticEvent);
        }
    }
});

function type(e) {
    e.target.textContent=caption.substr(0, captionLength++);
    if(captionLength < caption.length+1) {
        setTimeout(type(e), 1000);
    } else {
        captionLength = 0;
        caption = '';
    }
};

async function typeSentence(sentence, eleRef, delay = 10) {
    const letters = sentence.split("");
    let i = 0;
    
    // Wrap content in a span for character-level opacity control
    eleRef.innerHTML = '<span style="display: inline;"></span>';
    const container = eleRef.querySelector('span');
    
    // Create pencil cursor icon
    const pencil = document.createElement('span');
    pencil.innerHTML = '✏️';
    pencil.style.display = 'inline';
    pencil.style.marginLeft = '2px';
    pencil.style.animation = 'pencil-bounce 0.5s ease-in-out infinite';
    pencil.id = 'writing-pencil';
    
    // Add CSS animation for pencil bounce
    if (!document.getElementById('pencil-animation-style')) {
      const style = document.createElement('style');
      style.id = 'pencil-animation-style';
      style.textContent = `
        @keyframes pencil-bounce {
          0%, 100% { transform: translateY(0px) rotate(-15deg); }
          50% { transform: translateY(-3px) rotate(-15deg); }
        }
      `;
      document.head.appendChild(style);
    }
    
    eleRef.appendChild(pencil);
    
    while(i < letters.length) {
      // Only wait for non-space characters
      if (letters[i] !== ' ') {
        await waitForMs(delay);
      }
      
      // Create new character span with fade-in animation
      const charSpan = document.createElement('span');
      charSpan.textContent = letters[i];
      charSpan.style.opacity = '0';
      charSpan.style.display = 'inline';
      charSpan.style.transition = `opacity ${delay * 0.8}ms ease-in`;
      container.appendChild(charSpan);
      
      // Trigger fade-in
      setTimeout(() => {
        charSpan.style.opacity = '1';
      }, 10);
      
      i++
    }
    
    // Remove pencil when done
    pencil.remove();
    
    audio_src.pause();
    audio_src.currentTime = 0;
    return;
  }
  
  
  function waitForMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }



