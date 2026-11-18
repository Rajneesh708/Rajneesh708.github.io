
  // Filter & search functionality
  (function () {
    var searchInput  = document.getElementById('insSearch');
    var filterBtns   = document.querySelectorAll('.ins-filter-btn');
    var allCards     = document.querySelectorAll('.ins-card');
    var countEl      = document.getElementById('insCount');
    var noResults    = document.getElementById('insNoResults');
    var clearBtn     = document.getElementById('insClearBtn');
    var grid         = document.getElementById('insGrid');

    if (!searchInput || !filterBtns.length || !allCards.length) return;

    var currentCat   = 'all';
    var currentSearch = '';

    function filterCards() {
      var visible = 0;
      allCards.forEach(function (card) {
        var cat     = card.dataset.category || '';
        var title   = (card.dataset.title || '').toLowerCase();
        var excerpt = (card.querySelector('.ins-excerpt') || {}).textContent || '';
        excerpt = excerpt.toLowerCase();

        var catMatch    = currentCat === 'all' || cat === currentCat;
        var searchMatch = currentSearch === '' ||
                          title.includes(currentSearch) ||
                          excerpt.includes(currentSearch);

        if (catMatch && searchMatch) {
          card.style.display = 'flex';
          visible++;
        } else {
          card.style.display = 'none';
        }
      });

      if (countEl) {
        countEl.textContent = visible + ' article' + (visible !== 1 ? 's' : '');
      }

      if (visible === 0) {
        if (noResults) noResults.classList.add('active');
        if (grid) grid.style.display = 'none';
      } else {
        if (noResults) noResults.classList.remove('active');
        if (grid) grid.style.display = 'grid';
      }
    }

    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        filterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentCat = btn.dataset.category;
        filterCards();
      });
    });

    searchInput.addEventListener('input', function () {
      currentSearch = searchInput.value.toLowerCase().trim();
      filterCards();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        currentCat = 'all';
        currentSearch = '';
        searchInput.value = '';
        filterBtns.forEach(function (b) { b.classList.remove('active'); });
        filterBtns[0].classList.add('active');
        filterCards();
      });
    }

    filterCards();
  })();
