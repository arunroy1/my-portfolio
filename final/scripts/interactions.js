
document.addEventListener('DOMContentLoaded', () => {
    // Only init if theme is futuristic or we want dynamic features globally?
    // User requested "new one completely different from myown", implying advanced features belong to new theme.
    // We will check periodically or on interaction.

    // Initial check
    checkAndInitFeatures();

    // Listen for theme changes via a custom event or attribute observer would be best,
    // but the simplest way given our switch logic is polling or re-checking in events.
    // Better: let's expose an init function or use a mutation observer on body.

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === "attributes" && mutation.attributeName === "data-active-theme") {
                checkAndInitFeatures();
            }
        });
    });

    observer.observe(document.body, {
        attributes: true
    });
});

let isTypingInit = false;
let isCursorInit = false;

function checkAndInitFeatures() {
    const activeTheme = document.body.getAttribute('data-active-theme');

    // We only want these effects if the theme is 'futuristic'
    if (activeTheme === 'futuristic') {
        document.body.classList.add('enable-advanced-ui');
        if (!isCursorInit) {
            initCustomCursor();
            isCursorInit = true;
        }
        initScrollReveal();

        if (!isTypingInit) {
            initTypingEffect();
            isTypingInit = true;
        }

        init3DTilt();
        // Stop fluid sim
        if (window.fluidSim) window.fluidSim.stop();

    } else if (activeTheme === 'diary') {
        document.body.classList.remove('enable-advanced-ui');
        // Start fluid sim for diary
        if (window.fluidSim) window.fluidSim.start();

        // Ensure other futuristic effects are disabled
        const cursor = document.querySelector('.custom-cursor');
        const followers = document.querySelector('.cursor-follower');
        if (cursor) cursor.style.display = 'none';
        if (followers) followers.style.display = 'none';

        if (!isTypingInit) {
            initTypingEffect();
            isTypingInit = true;
        }
    } else {
        document.body.classList.remove('enable-advanced-ui');
        if (window.fluidSim) window.fluidSim.stop();

        const cursor = document.querySelector('.custom-cursor');
        const followers = document.querySelector('.cursor-follower');
        if (cursor) cursor.style.display = 'none';
        if (followers) followers.style.display = 'none';
    }
}

/* -------------------------------------------------------------------------- */
/*                               Scroll Reveal                                */
/* -------------------------------------------------------------------------- */
function initScrollReveal() {
    // Logic remains same, but CSS controls visibility
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    const elementsToReveal = document.querySelectorAll('section, .project-card, .experience-card, header, .nav-links');
    elementsToReveal.forEach(el => {
        el.classList.add('reveal-element');
        observer.observe(el);
    });
}

/* -------------------------------------------------------------------------- */
/*                                 3D Tilt                                    */
/* -------------------------------------------------------------------------- */
function init3DTilt() {
    const cards = document.querySelectorAll('.project-card, .experience-card, .profile-img');

    cards.forEach(card => {
        // Remove old listeners to prevent duplication? 
        // Cloning node is a dirty hack to remove listeners. 
        // Better to check flag in event handler.
    });

    // We'll use a global event delegation or check in the handler
    document.removeEventListener('mousemove', handleTilt);
    document.addEventListener('mousemove', handleTilt);
}



/* -------------------------------------------------------------------------- */
/*                               Scroll Reveal                                */
/* -------------------------------------------------------------------------- */
function initScrollReveal() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    const elementsToReveal = document.querySelectorAll('section, .project-card, .experience-card, header, .nav-links');
    elementsToReveal.forEach(el => {
        el.classList.add('reveal-element');
        observer.observe(el);
    });
}

/* -------------------------------------------------------------------------- */
/*                                 3D Tilt                                    */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/*                                 3D Tilt                                    */
/* -------------------------------------------------------------------------- */
let isTiltBound = false;

function init3DTilt() {
    if (isTiltBound) return;

    // Use global event delegation
    document.addEventListener('mousemove', handleTilt);

    // Also add a listener for mouseleave on the document to reset everything
    // or just rely on the 'mousemove' logic to bail out if theme changes.
    // Actually, we need to clean up if we switch AWAY from futuristic.
    // The checkAndInitFeatures function should handle the clean up logic.
    // But since listeners are hard to remove without reference, we stick to delegation
    // and just checking the theme inside the handler.
    isTiltBound = true;
}

function handleTilt(e) {
    const activeTheme = document.body.getAttribute('data-active-theme');

    // If not futuristic, ensure we clean up any residual transforms and return
    if (activeTheme !== 'futuristic') {
        const tiltedCards = document.querySelectorAll('[data-tilt-applied]');
        tiltedCards.forEach(card => {
            card.style.transform = '';
            card.style.removeProperty('--glare-x');
            card.style.removeProperty('--glare-y');
            card.removeAttribute('data-tilt-applied');
        });
        return;
    }

    // Find closest card
    // Note: We EXCLUDE .project-card because it now uses a CSS-based 3D flip.
    // Applying JS tilt AND CSS flip causes conflict and "messy" behavior.
    // We only apply tilt to profile-img and experience-card (which doesn't flip).
    const card = e.target.closest('.experience-card, .profile-img');

    if (!card) {
        // Reset any card we might have just left? 
        // No, mouseleave handles that locally usually.
        return;
    }

    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -10;
    const rotateY = ((x - centerX) / centerX) * 10;

    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.05, 1.05, 1.05)`;
    card.setAttribute('data-tilt-applied', 'true');

    const glareX = ((x / rect.width) * 100);
    const glareY = ((y / rect.height) * 100);
    card.style.setProperty('--glare-x', `${glareX}%`);
    card.style.setProperty('--glare-y', `${glareY}%`);

    // Reset on leave
    if (!card.hasAttribute('data-tilt-init')) {
        card.setAttribute('data-tilt-init', 'true');
        card.addEventListener('mouseleave', () => {
            card.style.transform = ''; // Clear inline transform to allow CSS hover effects to take over if any
            card.removeAttribute('data-tilt-applied');
        });
    }
}
function initTypingEffect() {
    const textElement = document.querySelector('.subtitle');
    if (!textElement) return;

    const originalText = "Student at California State University, Monterey Bay";
    const roles = [originalText, "Full Stack Developer", "UI/UX Enthusiast", "Creative Problem Solver"];
    let roleIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let typeSpeed = 100;

    function type() {
        const activeTheme = document.body.getAttribute('data-active-theme');
        // Check theme (allow both futuristic and diary)
        if (activeTheme !== 'futuristic' && activeTheme !== 'diary') {
            textElement.textContent = originalText; // Reset to default
            setTimeout(type, 1000); // Check again later
            return;
        }

        const currentRole = roles[roleIndex];
        let randomFactor = 0;

        // Add randomness for "handwritten" feel only in diary theme
        if (activeTheme === 'diary') {
            randomFactor = Math.random() * 100 - 50; // Variation of +/- 50ms
        }

        if (isDeleting) {
            textElement.textContent = currentRole.substring(0, charIndex - 1);
            charIndex--;
            typeSpeed = 50 + (randomFactor / 2); // Deleting is faster but also variable
        } else {
            textElement.textContent = currentRole.substring(0, charIndex + 1);
            charIndex++;
            // Slower speed for diary to feel like writing
            const baseSpeed = activeTheme === 'diary' ? 150 : 100;
            typeSpeed = baseSpeed + randomFactor;
        }

        // Validate typeSpeed is reasonable
        if (typeSpeed < 30) typeSpeed = 30;

        if (!isDeleting && charIndex === currentRole.length) {
            isDeleting = true;
            typeSpeed = 2000;
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            roleIndex = (roleIndex + 1) % roles.length;
            typeSpeed = 500;
        }

        setTimeout(type, typeSpeed);
    }

    type();
}

/* -------------------------------------------------------------------------- */
/*                               Custom Cursor                                */
/* -------------------------------------------------------------------------- */
function initCustomCursor() {
    const cursor = document.createElement('div');
    cursor.classList.add('custom-cursor');
    const follower = document.createElement('div');
    follower.classList.add('cursor-follower');
    document.body.appendChild(cursor);
    document.body.appendChild(follower);

    document.addEventListener('mousemove', (e) => {
        if (document.body.getAttribute('data-active-theme') !== 'futuristic') {
            cursor.style.display = 'none';
            follower.style.display = 'none';
            return;
        } else {
            cursor.style.display = 'block';
            follower.style.display = 'block';
        }

        cursor.style.left = e.clientX + 'px';
        cursor.style.top = e.clientY + 'px';

        setTimeout(() => {
            follower.style.left = e.clientX + 'px';
            follower.style.top = e.clientY + 'px';
        }, 50);
    });

    const interactiveElements = document.querySelectorAll('a, button, .project-card, .experience-card');
    interactiveElements.forEach(el => {
        el.addEventListener('mouseenter', () => {
            cursor.classList.add('expand');
            follower.classList.add('expand');
        });
        el.addEventListener('mouseleave', () => {
            cursor.classList.remove('expand');
            follower.classList.remove('expand');
        });
    });
}
