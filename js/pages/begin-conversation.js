
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
    setTimeout(function(){
      document.querySelectorAll('.rev').forEach(function(el){ el.classList.add('is-vis'); });
    }, 8000);
  })();
