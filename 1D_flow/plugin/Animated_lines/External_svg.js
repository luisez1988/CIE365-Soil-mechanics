const svgObjects = document.querySelectorAll('.Animation');

// Access contents of SVG file
svgObjects.forEach(svgObject => {
    svgObject.addEventListener('load', () => {
        const svgDoc = svgObject.contentDocument;
        if (svgDoc) {
            console.log('SVG loaded:', svgObject);

            // Hide elements with Animate class
            const svgPaths = svgDoc.querySelectorAll('.Animate');
            svgPaths.forEach(path => {
                const tagType = getTagType(path);
                if (tagType === 'path') {
                    // If path has dash style then save it
                    
                    
                    if (path.style.strokeDasharray) {
                        path.setAttribute('ns1:stroke-dasharray', path.style.strokeDasharray);
                        
                    }
                    path.style.strokeDasharray = path.getTotalLength();
                    path.style.strokeDashoffset = path.getTotalLength();
    
                    // If has fill then save the fill color and make it transparent
                    if (path.style.fill) {
                        path.setAttribute('ns1:fill', path.style.fill);
                        path.style.fill = 'transparent';
                    }   
    
                    // If path has markers then save info and make it transparent
    
                    if (path.style.markerEnd) {
                        path.setAttribute('ns1:marker-end', path.style.markerEnd);
                        path.style.markerEnd = 'none';
                    }
    
                    if (path.style.markerStart) {
                        path.setAttribute('ns1:marker-start', path.style.markerStart);
                        path.style.markerStart = 'none';
                    }
    
                    if (path.style.markerMid) {
                        path.setAttribute('ns1:marker-mid', path.style.markerMid);
                        path.style.markerMid = 'none';
                    }
    
    
                    // If ns1:texconverter="pdflatex" make it transparent works for latex
                    if (path.getAttribute('ns1:texconverter') === 'pdflatex') {
                        path.style.opacity = 0;    }                   
                    
                }
                            // If the tag type text make it transparent
            if (tagType === 'text') {
                path.style.opacity = 0;
            }  
            
            if (tagType === 'g') {
                path.style.opacity = 0;
            }

            if (tagType === 'circle') {
                path.style.opacity = 0;
            }
                
            });

            // Hide elements with class fragment
            const svgFragments = svgDoc.querySelectorAll('.fragment');
            svgFragments.forEach(fragment => {
                fragment.style.opacity = 0;
            });

            let currentPathIndex = 0; // Variable to keep track of the 
            // Add keydown event listener to the document
            svgDoc.addEventListener('click', () => {
                    console.log('Right arrow key pressed');
                    
                    if (currentPathIndex < svgPaths.length) {
                        const path = svgPaths[currentPathIndex];
                        // Select case based on the tag type
                        const tagType = getTagType(path);

                        // If the tag type is path
                        if (tagType === 'path') {
                        const pathLength = path.getTotalLength();
                        const parentElement = getParentElement(path);
                        const ParentTagType = getTagType(parentElement);

                        const animationDuration = pathLength / (ParentTagType === 'g' ? 35 : 30);
                        const strokeDashStyle = path.style.strokeDasharray;
                        path.style.strokeDasharray = pathLength;
                        path.style.strokeDashoffset = pathLength;
                        path.getBoundingClientRect(); // Trigger a reflow to ensure the animation works                 
                        
                        path.style.transition = `stroke-dashoffset ${animationDuration}s linear`;
                        path.style.strokeDashoffset = '0';
                        path.style.strokeDasharray = strokeDashStyle;

                        // delay two seconds
                        setTimeout(() => {
                            path.style.strokeDasharray = path.getAttribute('ns1:stroke-dasharray');
                            path.style.transition = 'fill 0.5s ease-in-out';
                            path.style.fill = path.getAttribute('ns1:fill');
                        }, animationDuration*1000);

                        // add markers with 1300 delay
                        setTimeout(() => {
                        if (path.style.markerEnd) {
                            path.style.markerEnd = path.getAttribute('ns1:marker-end');
                        }

                        if (path.style.markerStart) {
                            path.style.markerStart = path.getAttribute('ns1:marker-start');
                        }

                        if (path.style.markerMid) {
                            path.style.markerMid = path.getAttribute('ns1:marker-mid');
                        }
                        }   , animationDuration*1000);

                        // Recover original fill using an animation
                        // if (path.style.fill) {
                        //     //path.style.transition = 'fill 1s ease';
                        //     path.style.fill = path.getAttribute('ns1:fill');
                        // }

                        if (path.getAttribute('ns1:texconverter') === 'pdflatex') {
                            path.style.opacity = 1;    }  
                        }

                        // If the tag type is text fade in increaseing opacity
                        if (tagType === 'text') {
                        path.style.transition = 'opacity 1s ease';   
                        path.style.opacity = 1;
                        } 
                        
                        if (tagType === 'g') {    
                        path.style.transition = 'opacity 1s ease';
                        path.style.opacity = 1;     }     

                        if (tagType === 'circle') {    
                            path.style.transition = 'opacity 1s ease';
                            path.style.opacity = 1;     } 


                        currentPathIndex++;
                    }

                }
            );

            let currentFragmentIndex = 0; // Variable to keep track of the
            // Add keydown event listener to the document
            svgDoc.addEventListener('keydown', event => {
                if (event.key === 'ArrowRight') {
                    console.log('Right arrow key pressed');
                    if (currentFragmentIndex < svgFragments.length) {
                        const fragment = svgFragments[currentFragmentIndex];
                        fragment.style.opacity = 1;
                        currentFragmentIndex++;
                    }
                }
            });
        } else {
            console.error('SVG contentDocument is null:', svgObject);
        }
    });
});

// Function to get the type of tag an element is
function getTagType(element) {
    return element.tagName.toLowerCase(); // Convert to lowercase for consistency
}

// Function to get the parent element of a specific tag
function getParentElement(element) {
    return element.parentElement;
}

