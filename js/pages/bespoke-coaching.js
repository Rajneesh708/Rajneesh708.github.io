
  (function(){
    /* Scroll-reveal observer */
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ e.target.classList.add('vis'); io.unobserve(e.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.rev').forEach(function(el){ io.observe(el); });

    /* Animate transfer bars on scroll into view */
    var bLow = document.getElementById('barLow');
    var bHigh = document.getElementById('barHigh');
    if (bLow && bHigh) {
      var barIo = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if(e.isIntersecting){
            bLow.style.width = '12%';
            bHigh.style.width = '60%';
            barIo.disconnect();
          }
        });
      }, { threshold: 0.4 });
      barIo.observe(document.querySelector('.b-transfer'));
    }
  })();
