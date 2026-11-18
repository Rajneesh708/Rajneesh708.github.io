
  /* Reveal-on-scroll with defensive fallback */
  (function(){
    if (!('IntersectionObserver' in window)) return;
    document.body.setAttribute('data-reveal-ready', '1');
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting) {
          e.target.classList.add('is-vis');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.rev').forEach(function(el){ io.observe(el); });
    /* Safety net - force show all reveals after 8s if any haven't fired */
    setTimeout(function(){
      document.querySelectorAll('.rev').forEach(function(el){ el.classList.add('is-vis'); });
    }, 8000);
  })();

  /* Auth tabs */
  (function(){
    var tabs = document.querySelectorAll('.cv-tab');
    var panels = document.querySelectorAll('.cv-tab-panel');
    tabs.forEach(function(tab){
      tab.addEventListener('click', function(){
        tabs.forEach(function(t){
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        panels.forEach(function(p){
          p.classList.remove('active');
          p.setAttribute('hidden', '');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        var panelId = tab.getAttribute('aria-controls');
        var panel = document.getElementById(panelId);
        if (panel) {
          panel.classList.add('active');
          panel.removeAttribute('hidden');
        }
      });
    });
  })();
