// Serialized into the page. A single description-only expansion, never Apply.
export function expandDescription() {
 const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const containers=[...document.querySelectorAll('.description__text,#job-details')].filter(visible);
 if(containers.length!==1)return false;
 const scope=containers[0].closest('section.description,.jobs-description')||containers[0];
 const buttons=[...scope.querySelectorAll('.show-more-less-html__button--more,button[aria-label="Show more description"],button[aria-label="Click to see more description"]')].filter(e=>visible(e)&&!e.disabled&&e.getAttribute('aria-expanded')!=='true'&&e.getAttribute('aria-disabled')!=='true');
 if(buttons.length!==1||!buttons[0].matches('button'))return false;
 buttons[0].click();return true;
}
