// Battlebox SPA - minimal client-side app
(async function() {
    const app = document.getElementById('app');

    // Fetch battleboxes
    const res = await fetch('/api/decks/');
    const battleboxes = await res.json();

    app.innerHTML = `
        <h1>Battlebox</h1>
        <ul>
            ${battleboxes.map(b => `<li><a href="/${b}">${b}</a></li>`).join('')}
        </ul>
    `;
})();
