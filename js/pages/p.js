
(function () {
  "use strict";

  /* -- Helpers ---------------------------------------------- */
  function getSlug() {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("slug") || "").trim();
    if (q) return q;
    const m = window.location.pathname.match(/\/p\/([a-z0-9][a-z0-9-]*)\/?$/i);
    if (m && m[1]) return m[1];
    const h = window.location.hash.match(/\/p\/([a-z0-9][a-z0-9-]*)/i);
    if (h && h[1]) return h[1];
    return "";
  }

  function show(id) { const el = document.getElementById(id); if (el) el.hidden = false; }
  function hide(id) { const el = document.getElementById(id); if (el) el.hidden = true; }
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || "";
  }
  function escapeHtml(s) {
    if (!s && s !== 0) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* Strip http(s):// for display, keep the link's href intact */
  function prettyUrl(url) {
    if (!url) return "";
    return String(url).replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
  function safeHref(url) {
    if (!url) return "";
    const s = String(url).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(s)) return "https://" + s;
    return s;
  }

  function formatDateRange(item) {
    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function fmt(year, month) {
      if (!year) return "";
      const m = parseInt(month, 10);
      if (m >= 1 && m <= 12) return monthNames[m] + " " + year;
      return String(year);
    }
    const start = fmt(item.start_year, item.start_month);
    const end = item.is_current ? "Present" : fmt(item.end_year, item.end_month);
    if (start && end) return start + " &ndash; " + end;
    if (start) return start + " &ndash; Present";
    return "";
  }

  function buildPhotoUrl(path) {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    return SUPABASE_URL.replace(/\/+$/, "") +
           "/storage/v1/object/public/photos/" +
           path.split("/").map(encodeURIComponent).join("/");
  }

  function initialsFromName(name) {
    if (!name) return "&bull;";
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function preferCustom(value, customValue) {
    if (!value) return customValue || "";
    const v = String(value).toLowerCase().trim();
    if (v === "other" || v === "other (please specify)" ||
        v === "please specify" || v.indexOf("other") === 0) {
      return (customValue && String(customValue).trim()) || value;
    }
    return value;
  }

  function splitList(s) {
    if (!s) return [];
    if (Array.isArray(s)) return s.map(function (x) { return String(x).trim(); }).filter(Boolean);
    return String(s).split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* Title-case a snake_case key for display ("end_to_end" ? "End To End") */
  function titleize(s) {
    if (!s) return "";
    return String(s).replace(/_/g, " ")
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /* -- HERO -------------------------------------------------- */
  function renderHero(p) {
    const photoEl  = document.getElementById("ppPhoto");
    const avatarEl = document.getElementById("ppAvatar");
    const photoUrl = buildPhotoUrl(p.photo_path);

    if (avatarEl) {
      avatarEl.textContent = initialsFromName(p.name);
      avatarEl.hidden = false;
    }
    if (photoEl) {
      photoEl.hidden = true;
      photoEl.alt = "";
      photoEl.removeAttribute("src");
      if (photoUrl) {
        photoEl.onload = function () {
          photoEl.hidden = false;
          if (avatarEl) avatarEl.hidden = true;
        };
        photoEl.onerror = function () {
          photoEl.hidden = true;
          if (avatarEl) avatarEl.hidden = false;
        };
        photoEl.alt = (p.name || "Profile") + " &ndash; profile photo";
        photoEl.src = photoUrl;
      }
    }

    setText("ppName", p.name);

    const catMap = {
      "working_professional": "Working Professional",
      "fresher":              "Fresher",
      "student_0xp":          "Student",
      "student_intern":       "Student (with internships)",
      "student_xp":           "Student (with work experience)",
      "homemaker":            "Homemaker / Returning to Work",
      "self_employed":        "Self-Employed",
      "retired":              "Retired Professional",
      "researcher":           "Researcher / Innovator",
      "defense":              "Defense Personnel",
      "defense_family":       "Defense Family Member"
    };
    const cat = (p.profile_category && p.profile_category.user_type) || "";
    /* Smarter eyebrow: if the user is a working_professional whose
       current_position contains "founder", "co-founder", "ceo", "cto",
       "owner", or "director" &ndash; use that role as the category label
       instead of the generic "Working Professional". A founder reads
       differently than an employee. */
    let eyebrow = catMap[cat] || cat.replace(/_/g, " ");
    const cp = ((p.introduction && p.introduction.current_position) || "").toLowerCase();
    if (cat === "working_professional" || cat === "self_employed") {
      if (/\b(co[-\s]?founder|founder)\b/.test(cp))   eyebrow = "Founder";
      else if (/\bceo\b/.test(cp))                    eyebrow = "Chief Executive";
      else if (/\bcto\b/.test(cp))                    eyebrow = "Chief Technology Officer";
      else if (/\bcfo\b/.test(cp))                    eyebrow = "Chief Financial Officer";
      else if (/\bcoo\b/.test(cp))                    eyebrow = "Chief Operating Officer";
      else if (/\bcmo\b/.test(cp))                    eyebrow = "Chief Marketing Officer";
      else if (/\bowner\b/.test(cp))                  eyebrow = "Business Owner";
    }
    setText("ppCategory", eyebrow);

    const intro = p.introduction || {};
    setText("ppHeadline", intro.headline || "");

    /* Position-at-Company */
    const cpEl = document.getElementById("ppCurrentPosition");
    if (cpEl) {
      const position = intro.current_position && String(intro.current_position).trim();
      let mostRecentCompany = "";
      if (Array.isArray(p.experiences) && p.experiences.length) {
        const sorted = p.experiences.slice().sort(function (a, b) {
          if (a.is_current && !b.is_current) return -1;
          if (b.is_current && !a.is_current) return 1;
          return (b.experience_number || 0) - (a.experience_number || 0);
        });
        mostRecentCompany = (sorted[0] && sorted[0].company_name) || "";
      }
      let combined = "";
      if (position && mostRecentCompany) {
        combined = position + " at " + mostRecentCompany;
      } else if (position) {
        combined = position;
      } else if (mostRecentCompany) {
        combined = mostRecentCompany;
      }
      if (combined) {
        cpEl.textContent = combined;
        cpEl.hidden = false;
      } else {
        cpEl.hidden = true;
      }
    }

    /* Bio meta &ndash; Location &middot; "X years of experience" (never just "X years") */
    const loc = [intro.res_state, intro.res_country].filter(Boolean).join(", ");
    const bioEl = document.getElementById("ppBioLine");
    if (bioEl) {
      const parts = [];
      if (loc) parts.push(loc);
      if (cat === "defense") {
        if (intro.service_branch)   parts.push(intro.service_branch);
        if (intro.rank_designation) parts.push(intro.rank_designation);
        if (intro.years_of_service) parts.push(intro.years_of_service + " years of service");
      } else {
        if (intro.total_experience) parts.push(intro.total_experience + " years of experience");
      }
      if (parts.length) {
        bioEl.innerHTML = parts.map(escapeHtml)
          .join('<span class="pp-hero__sep">&middot;</span>');
        bioEl.hidden = false;
      } else {
        bioEl.hidden = true;
      }
    }

    /* Badges */
    const bWrap = document.getElementById("ppBadges");
    bWrap.innerHTML = "";
    if (p.consulting && p.consulting.availability_status &&
        p.consulting.availability_status !== "not_available") {
      const b = document.createElement("span");
      b.className = "pp-badge";
      b.textContent = "Available for consulting";
      bWrap.appendChild(b);
    }
    if (p.mentorship && Array.isArray(p.mentorship.roles) && p.mentorship.roles.length) {
      const b = document.createElement("span");
      b.className = "pp-badge";
      b.textContent = "Open to mentoring";
      bWrap.appendChild(b);
    }
    if (cat === "defense" && intro.career_transition &&
        /^(yes|maybe)$/i.test(String(intro.career_transition))) {
      const b = document.createElement("span");
      b.className = "pp-badge";
      b.textContent = "Open to civilian roles";
      bWrap.appendChild(b);
    }

    /* Reveal the navy hero band itself (it's hidden until data loads) */
    show("ppHeroBand");
  }

  /* -- ABOUT ------------------------------------------------- */
  function renderBio(p) {
    const intro = p.introduction || {};
    if (intro.summary) {
      setText("ppBio", intro.summary);
      show("ppBioSection");
    }
  }

  /* -- EXPERIENCE -------------------------------------------- */
  function renderExperience(p) {
    if (!Array.isArray(p.experiences) || !p.experiences.length) return;
    const list = document.getElementById("ppExpList");
    list.innerHTML = "";

    const sorted = p.experiences.slice().sort(function (a, b) {
      if (a.is_current && !b.is_current) return -1;
      if (b.is_current && !a.is_current) return 1;
      return (b.experience_number || 0) - (a.experience_number || 0);
    });

    sorted.forEach(function (e) {
      const item = document.createElement("div");
      item.className = "pp-exp__item";

      const country  = preferCustom(e.country, e.country_other);
      const locParts = [e.city, country].filter(function (s) {
        return s && String(s).trim();
      });
      const location = locParts.join(", ");
      const dateStr  = formatDateRange(e);

      const dateLocParts = [];
      if (dateStr)  dateLocParts.push(escapeHtml(dateStr));
      if (location) dateLocParts.push(escapeHtml(location));
      const dateLocLine = dateLocParts.join('<span class="pp-exp__sep">&middot;</span>');

      const fnLine = splitList(e.industry_function).join(", ");

      const allSkills = []
        .concat(splitList(e.domain_skills))
        .concat(splitList(e.tech_skills))
        .concat(splitList(e.soft_skills));

      let html = "";
      html += '<div class="pp-exp__role">' +
              escapeHtml(e.designation || e.role_headline || "") + '</div>';
      if (e.company_name) {
        html += '<div class="pp-exp__company">' + escapeHtml(e.company_name) + '</div>';
      }
      if (dateLocLine) {
        html += '<div class="pp-exp__dateloc">' + dateLocLine + '</div>';
      }
      if (fnLine) {
        html += '<div class="pp-exp__what">' + escapeHtml(fnLine) + '</div>';
      }
      if (e.role_description) {
        html += '<div class="pp-exp__desc">' + escapeHtml(e.role_description) + '</div>';
      }

      if (Array.isArray(e.projects) && e.projects.length) {
        const valid = e.projects.filter(function (proj) { return proj && proj.name; });
        if (valid.length) {
          html += '<div class="pp-exp__projects">';
          html += '<div class="pp-exp__projects-label">Key projects</div>';
          valid.forEach(function (proj) {
            const headerBits = [];
            headerBits.push('<span class="pp-exp__project-name">' +
                            escapeHtml(proj.name) + '</span>');
            if (proj.duration_months) {
              const n = parseInt(proj.duration_months, 10);
              const word = (n === 1) ? "month" : "months";
              headerBits.push(escapeHtml(n + " " + word));
            }
            if (proj.team_size) {
              const t = parseInt(proj.team_size, 10);
              headerBits.push(escapeHtml("Team of " + t));
            }
            html += '<div class="pp-exp__project">';
            html += '<div class="pp-exp__project-header">' +
                    headerBits.join('<span class="pp-exp__sep">&middot;</span>') + '</div>';
            if (proj.ask) {
              html += '<div class="pp-exp__project-line">' +
                      '<span class="pp-exp__project-key">Ask:</span>' +
                      escapeHtml(proj.ask) + '</div>';
            }
            if (proj.role) {
              html += '<div class="pp-exp__project-line">' +
                      '<span class="pp-exp__project-key">My role:</span>' +
                      escapeHtml(proj.role) + '</div>';
            }
            if (proj.deliverable) {
              html += '<div class="pp-exp__project-line">' +
                      '<span class="pp-exp__project-key">Outcome:</span>' +
                      escapeHtml(proj.deliverable) + '</div>';
            }
            html += '</div>';
          });
          html += '</div>';
        }
      }

      if (allSkills.length) {
        html += '<div class="pp-exp__skills-line">' +
                allSkills.map(escapeHtml)
                  .join('<span class="pp-exp__skills-sep"> &middot; </span>') +
                '</div>';
      }

      item.innerHTML = html;
      list.appendChild(item);
    });
    show("ppExpSection");
  }

  /* -- EDUCATION --------------------------------------------- */
  function renderEducation(p) {
    const list = document.getElementById("ppEduList");
    list.innerHTML = "";
    let any = false;

    const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function fmtMY(year, month) {
      if (!year) return "";
      const m = parseInt(month, 10);
      if (m >= 1 && m <= 12) return monthNames[m] + " " + year;
      return String(year);
    }

    function projectsHtml(arr, label) {
      if (!Array.isArray(arr) || !arr.length) return "";
      const valid = arr.filter(function (proj) { return proj && proj.name; });
      if (!valid.length) return "";
      let html = '<div class="pp-edu__projects">';
      html += '<div class="pp-edu__projects-label">' + escapeHtml(label || "Academic Projects") + '</div>';
      valid.forEach(function (proj) {
        html += '<div class="pp-edu__project">';
        html += '<div class="pp-edu__project-name">' + escapeHtml(proj.name) + '</div>';
        if (proj.ask) {
          html += '<div class="pp-edu__project-line"><span class="pp-edu__project-key">Ask:</span>' +
                  escapeHtml(proj.ask) + '</div>';
        }
        if (proj.role) {
          html += '<div class="pp-edu__project-line"><span class="pp-edu__project-key">Role:</span>' +
                  escapeHtml(proj.role) + '</div>';
        }
        if (proj.deliverable) {
          html += '<div class="pp-edu__project-line"><span class="pp-edu__project-key">Outcome:</span>' +
                  escapeHtml(proj.deliverable) + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
      return html;
    }

    if (p.education_current &&
        (p.education_current.institution_name ||
         p.education_current.education_level ||
         p.education_current.field_of_study)) {
      const c = p.education_current;
      const item = document.createElement("div");
      item.className = "pp-edu__item";

      const start = fmtMY(c.edu_start_year, c.edu_start_month);
      const end   = fmtMY(c.edu_end_year,   c.edu_end_month);
      let dateStr = "";
      if (c.currently_pursuing === "yes" || c.currently_pursuing === true) {
        dateStr = start ? (start + " &ndash; Present") : "In progress";
        if (end) dateStr = start + " &ndash; Expected " + end;
      } else if (start && end) dateStr = start + " &ndash; " + end;
      else if (start) dateStr = start + " &ndash; Present";
      else if (end) dateStr = "Expected " + end;

      const degreeLine = (c.education_level || "") +
        (c.field_of_study ? " &ndash; " + c.field_of_study : "");

      let html = "";
      html += '<div class="pp-edu__degree">' + escapeHtml(degreeLine) + '</div>';
      if (c.institution_name) {
        html += '<div class="pp-edu__inst">' + escapeHtml(c.institution_name) + '</div>';
      }
      if (dateStr) {
        html += '<div class="pp-edu__year">' + escapeHtml(dateStr) + '</div>';
      }
      if (c.education_mode) {
        html += '<div class="pp-edu__mode">' +
                '<span class="pp-edu__mode-label">Mode:</span>' +
                escapeHtml(c.education_mode) + '</div>';
      }
      html += projectsHtml(c.current_projects, "Current Projects");

      item.innerHTML = html;
      list.appendChild(item);
      any = true;
    }

    if (Array.isArray(p.education) && p.education.length) {
      const sorted = p.education.slice().sort(function (a, b) {
        return (b.education_number || 0) - (a.education_number || 0);
      });
      sorted.forEach(function (e) {
        const item = document.createElement("div");
        item.className = "pp-edu__item";

        const start = fmtMY(e.start_year, e.start_month);
        const end   = fmtMY(e.end_year,   e.end_month);
        let dateStr = "";
        if (start && end) dateStr = start + " &ndash; " + end;
        else if (start)   dateStr = start;
        else if (end)     dateStr = end;

        const degreeLine = (e.degree || "") +
          (e.field_of_study ? " &ndash; " + e.field_of_study : "");

        let html = "";
        html += '<div class="pp-edu__degree">' + escapeHtml(degreeLine) + '</div>';
        if (e.institution) {
          html += '<div class="pp-edu__inst">' + escapeHtml(e.institution) + '</div>';
        }
        if (dateStr) {
          html += '<div class="pp-edu__year">' + escapeHtml(dateStr) + '</div>';
        }
        if (e.grade) {
          html += '<div class="pp-edu__grade">' +
                  '<span class="pp-edu__grade-label">Grade:</span>' +
                  escapeHtml(e.grade) + '</div>';
        }
        const eduSkills = splitList(e.skills);
        if (eduSkills.length) {
          html += '<div class="pp-edu__skills-line">' +
                  '<span class="pp-edu__skills-label">Skills:</span>' +
                  eduSkills.map(escapeHtml)
                    .join('<span class="pp-edu__skills-sep"> &middot; </span>') +
                  '</div>';
        }
        if (e.activities) {
          html += '<div class="pp-edu__activities">' +
                  '<span class="pp-edu__activities-label">Activities:</span>' +
                  escapeHtml(e.activities) + '</div>';
        }
        html += projectsHtml(e.projects, "Academic Projects");

        item.innerHTML = html;
        list.appendChild(item);
        any = true;
      });
    }

    if (any) show("ppEduSection");
  }

  /* -- SKILLS ------------------------------------------------ */
  function renderSkills(p) {
    let groups = [];
    let flatItems = null;

    if (Array.isArray(p.skills) && p.skills.length) {
      const byCategory = new Map();
      let anyCategory = false;
      p.skills.forEach(function (s) {
        if (!s) return;
        const name = (typeof s === "string") ? s : (s.name || s.skill || s.label || "");
        if (!name) return;
        const cat  = (typeof s === "object" && s.category)    ? s.category    : "";
        const prof = (typeof s === "object" && s.proficiency) ? s.proficiency : "";
        if (cat) anyCategory = true;
        const key = cat || "_uncategorised";
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key).push({ name: name, proficiency: prof });
      });
      if (anyCategory) {
        const cats = Array.from(byCategory.keys()).sort(function (a, b) {
          if (a === "_uncategorised") return 1;
          if (b === "_uncategorised") return -1;
          if (a === "Other") return 1;
          if (b === "Other") return -1;
          return a.localeCompare(b);
        });
        cats.forEach(function (cat) {
          groups.push({
            category: cat === "_uncategorised" ? "" : cat,
            items: byCategory.get(cat)
          });
        });
      } else {
        flatItems = [];
        byCategory.forEach(function (arr) {
          arr.forEach(function (it) { flatItems.push(it); });
        });
      }
    } else {
      const top5 = (p.introduction && p.introduction.skills_top5) || [];
      let labels = [];
      if (Array.isArray(top5)) labels = top5.slice();
      else if (typeof top5 === "string" && top5.trim()) {
        labels = top5.split(",").map(function (s) { return s.trim(); });
      }
      labels = labels.filter(Boolean);
      if (labels.length) {
        flatItems = labels.map(function (l) { return { name: l, proficiency: "" }; });
      }
    }

    const intro = p.introduction || {};
    if (intro.defense_skills && String(intro.defense_skills).trim()) {
      const defSkills = splitList(intro.defense_skills);
      if (defSkills.length) {
        groups.push({
          category: "Defense Skills",
          items: defSkills.map(function (s) { return { name: s, proficiency: "" }; })
        });
      }
    }

    if (!groups.length && (!flatItems || !flatItems.length)) return;

    const list = document.getElementById("ppSkillsList");
    list.innerHTML = "";

    function renderItemHtml(item) {
      if (item.proficiency) {
        return escapeHtml(item.name) +
          ' <span class="pp-skill__level">&middot; ' + escapeHtml(item.proficiency) + '</span>';
      }
      return escapeHtml(item.name);
    }

    if (flatItems && flatItems.length) {
      const line = document.createElement("div");
      line.className = "pp-skill-line";
      line.innerHTML = flatItems.map(renderItemHtml)
        .join('<span class="pp-skill-sep"> &middot; </span>');
      list.appendChild(line);
    } else {
      groups.forEach(function (g) {
        const groupEl = document.createElement("div");
        groupEl.className = "pp-skill-group";
        if (g.category) {
          const lbl = document.createElement("div");
          lbl.className = "pp-skill-group__label";
          lbl.textContent = g.category;
          groupEl.appendChild(lbl);
        }
        const line = document.createElement("div");
        line.className = "pp-skill-line";
        line.innerHTML = g.items.map(renderItemHtml)
          .join('<span class="pp-skill-sep"> &middot; </span>');
        groupEl.appendChild(line);
        list.appendChild(groupEl);
      });
    }
    show("ppSkillsSection");
  }

  /* -- KEY ACHIEVEMENTS -------------------------------------- */
  function renderAchievements(p) {
    if (!Array.isArray(p.key_achievements) || !p.key_achievements.length) return;
    const list = document.getElementById("ppAchList");
    list.innerHTML = "";
    p.key_achievements.forEach(function (a) {
      if (!a || !a.title) return;
      const item = document.createElement("div");
      item.className = "pp-list__item";
      let html = '<div class="pp-list__title">' + escapeHtml(a.title) + '</div>';
      if (a.category) {
        html += '<div class="pp-list__sub">' + escapeHtml(a.category) + '</div>';
      }
      if (a.impact) {
        html += '<div class="pp-list__desc">' + escapeHtml(a.impact) + '</div>';
      }
      if (a.verify_url) {
        html += '<a class="pp-list__link" href="' + escapeAttr(safeHref(a.verify_url)) +
                '" target="_blank" rel="noopener noreferrer">' +
                escapeHtml(prettyUrl(a.verify_url)) + '</a>';
      }
      item.innerHTML = html;
      list.appendChild(item);
    });
    if (list.children.length) show("ppAchSection");
  }

  /* -- CERTIFICATIONS ---------------------------------------- */
  function renderCertifications(p) {
    if (!Array.isArray(p.certifications) || !p.certifications.length) return;
    const list = document.getElementById("ppCertList");
    list.innerHTML = "";
    const sorted = p.certifications.slice().sort(function (a, b) {
      if (a.is_current && !b.is_current) return -1;
      if (b.is_current && !a.is_current) return 1;
      return (b.start_year || 0) - (a.start_year || 0);
    });
    sorted.forEach(function (c) {
      if (!c || !c.name) return;
      const item = document.createElement("div");
      item.className = "pp-list__item";

      const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      function fmt(y, m) {
        if (!y) return "";
        const mm = parseInt(m, 10);
        return (mm >= 1 && mm <= 12 ? monthNames[mm] + " " : "") + y;
      }
      const start = fmt(c.start_year, c.start_month);
      const end   = c.is_current ? "" : fmt(c.end_year, c.end_month);
      let dateStr = "";
      if (start && end) dateStr = start + " &ndash; " + end;
      else if (start && c.is_current) dateStr = start + " &ndash; No expiry";
      else if (start) dateStr = "Issued " + start;
      else if (end) dateStr = "Valid until " + end;

      let html = '<div class="pp-list__title">' + escapeHtml(c.name) + '</div>';
      if (c.issuing_org) {
        html += '<div class="pp-list__sub">' + escapeHtml(c.issuing_org) + '</div>';
      }
      if (dateStr) {
        html += '<div class="pp-list__meta">' + escapeHtml(dateStr) + '</div>';
      }
      if (c.credential_url) {
        html += '<a class="pp-list__link" href="' + escapeAttr(safeHref(c.credential_url)) +
                '" target="_blank" rel="noopener noreferrer">' +
                escapeHtml(prettyUrl(c.credential_url)) + '</a>';
      }
      item.innerHTML = html;
      list.appendChild(item);
    });
    if (list.children.length) show("ppCertSection");
  }

  /* -- PUBLICATIONS ------------------------------------------ */
  function renderPublications(p) {
    if (!Array.isArray(p.publications) || !p.publications.length) return;
    const list = document.getElementById("ppPubList");
    list.innerHTML = "";
    const sorted = p.publications.slice().sort(function (a, b) {
      return (b.year || 0) - (a.year || 0);
    });
    sorted.forEach(function (pub) {
      if (!pub || !pub.title) return;
      const item = document.createElement("div");
      item.className = "pp-list__item";

      let html = '<div class="pp-list__title">' + escapeHtml(pub.title) + '</div>';
      const subBits = [];
      if (pub.outlet) subBits.push(escapeHtml(pub.outlet));
      if (pub.year) subBits.push(escapeHtml(String(pub.year)));
      if (pub.pub_type) subBits.push(escapeHtml(titleize(pub.pub_type)));
      if (subBits.length) {
        html += '<div class="pp-list__meta">' +
                subBits.join('<span class="pp-list__sep">&middot;</span>') + '</div>';
      }
      if (pub.description) {
        html += '<div class="pp-list__desc">' + escapeHtml(pub.description) + '</div>';
      }
      if (pub.url) {
        html += '<a class="pp-list__link" href="' + escapeAttr(safeHref(pub.url)) +
                '" target="_blank" rel="noopener noreferrer">' +
                escapeHtml(prettyUrl(pub.url)) + '</a>';
      }
      item.innerHTML = html;
      list.appendChild(item);
    });
    if (list.children.length) show("ppPubSection");
  }

  /* -- PORTFOLIO (only show_on_profile items) ---------------- */
  function renderPortfolio(p) {
    if (!Array.isArray(p.portfolio) || !p.portfolio.length) return;
    const list = document.getElementById("ppPortList");
    list.innerHTML = "";
    p.portfolio.forEach(function (po) {
      if (!po || !po.title) return;
      /* Server already filters but defend in client too */
      if (po.show_on_profile === false) return;

      const item = document.createElement("div");
      item.className = "pp-list__item";
      let html = '<div class="pp-list__title">' + escapeHtml(po.title) + '</div>';
      if (po.work_type) {
        html += '<div class="pp-list__sub">' + escapeHtml(titleize(po.work_type)) + '</div>';
      }
      if (po.description) {
        html += '<div class="pp-list__desc">' + escapeHtml(po.description) + '</div>';
      }
      if (po.url) {
        html += '<a class="pp-list__link" href="' + escapeAttr(safeHref(po.url)) +
                '" target="_blank" rel="noopener noreferrer">' +
                escapeHtml(prettyUrl(po.url)) + '</a>';
      }
      item.innerHTML = html;
      list.appendChild(item);
    });
    if (list.children.length) show("ppPortSection");
  }

  /* -- VOLUNTEERING ------------------------------------------ */
  function renderVolunteering(p) {
    if (!Array.isArray(p.volunteering) || !p.volunteering.length) return;
    const list = document.getElementById("ppVolList");
    list.innerHTML = "";
    const sorted = p.volunteering.slice().sort(function (a, b) {
      if (a.is_ongoing && !b.is_ongoing) return -1;
      if (b.is_ongoing && !a.is_ongoing) return 1;
      return (b.from_year || 0) - (a.from_year || 0);
    });
    sorted.forEach(function (v) {
      if (!v || !v.role) return;
      const item = document.createElement("div");
      item.className = "pp-list__item";

      let dateStr = "";
      if (v.from_year && v.is_ongoing) dateStr = v.from_year + " &ndash; Present";
      else if (v.from_year && v.to_year) dateStr = v.from_year + " &ndash; " + v.to_year;
      else if (v.from_year) dateStr = String(v.from_year);
      else if (v.to_year) dateStr = String(v.to_year);

      let html = '<div class="pp-list__title">' + escapeHtml(v.role) + '</div>';
      if (v.organisation) {
        html += '<div class="pp-list__sub">' + escapeHtml(v.organisation) + '</div>';
      }
      const metaBits = [];
      if (v.cause) metaBits.push(escapeHtml(v.cause));
      if (dateStr) metaBits.push(escapeHtml(dateStr));
      if (metaBits.length) {
        html += '<div class="pp-list__meta">' +
                metaBits.join('<span class="pp-list__sep">&middot;</span>') + '</div>';
      }
      if (v.description) {
        html += '<div class="pp-list__desc">' + escapeHtml(v.description) + '</div>';
      }
      item.innerHTML = html;
      list.appendChild(item);
    });
    if (list.children.length) show("ppVolSection");
  }

  /* -- LANGUAGES --------------------------------------------- */
  function renderLanguages(p) {
    const langs = p.languages || {};
    const items = Array.isArray(langs.languages) ? langs.languages : [];
    if (!items.length) return;
    const list = document.getElementById("ppLangList");
    list.innerHTML = "";
    const valid = items.filter(function (l) { return l && l.name; });
    if (!valid.length) return;
    valid.forEach(function (l, i) {
      const span = document.createElement("span");
      let html = '<span class="pp-lang__name">' + escapeHtml(l.name) + '</span>';
      if (l.proficiency) {
        html += '<span class="pp-lang__level">&middot; ' + escapeHtml(l.proficiency) + '</span>';
      }
      span.innerHTML = html;
      list.appendChild(span);
      if (i < valid.length - 1) {
        const sep = document.createElement("span");
        sep.className = "pp-lang__sep";
        sep.textContent = "&middot;";
        list.appendChild(sep);
      }
    });
    show("ppLangSection");
  }

  /* -- PROFESSIONAL LINKS ------------------------------------ */
  function renderLinks(p) {
    const langs = p.languages || {};
    const linkRows = [
      { label: "LinkedIn",  url: langs.link_linkedin },
      { label: "GitHub",    url: langs.link_github },
      { label: "Portfolio", url: langs.link_portfolio },
      { label: "Other",     url: langs.link_other }
    ].filter(function (r) { return r.url && String(r.url).trim(); });

    if (!linkRows.length) return;
    const list = document.getElementById("ppLinksList");
    list.innerHTML = "";
    linkRows.forEach(function (r) {
      const row = document.createElement("div");
      row.className = "pp-links__row";
      row.innerHTML =
        '<div class="pp-links__label">' + escapeHtml(r.label) + '</div>' +
        '<a class="pp-links__url" href="' + escapeAttr(safeHref(r.url)) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(prettyUrl(r.url)) + '</a>';
      list.appendChild(row);
    });
    show("ppLinksSection");
  }

  /* -- CONSULTING -------------------------------------------- */
  function renderConsulting(p) {
    const c = p.consulting;
    if (!c || !c.show_on_profile) return;
    if (c.availability_status === "not_available") return;
    /* Need at least description or one structural field to bother rendering */
    if (!c.profile_description && !c.consulting_domains &&
        !c.consulting_industries && !c.engagement_type &&
        !c.past_work_highlight) return;

    const block = document.getElementById("ppConsBlock");
    block.innerHTML = "";
    let html = "";

    if (c.profile_description) {
      html += '<div class="pp-block__intro">' + escapeHtml(c.profile_description) + '</div>';
    }

    function renderRow(label, valueHtml) {
      if (!valueHtml) return "";
      return '<div class="pp-block__row">' +
             '<div class="pp-block__label">' + escapeHtml(label) + '</div>' +
             '<div class="pp-block__value">' + valueHtml + '</div>' +
             '</div>';
    }

    function listToInlineHtml(arr) {
      const items = splitList(arr);
      if (!items.length) return "";
      return items.map(escapeHtml)
        .join('<span class="pp-block__inline-sep"> &middot; </span>');
    }

    const domainsHtml = listToInlineHtml(c.consulting_domains);
    if (domainsHtml) html += renderRow("Domains", domainsHtml);

    const indHtml = listToInlineHtml(c.consulting_industries);
    if (indHtml) html += renderRow("Industries", indHtml);

    if (c.engagement_type) {
      const eng = Array.isArray(c.engagement_type)
        ? c.engagement_type.map(titleize).join(" &middot; ")
        : titleize(c.engagement_type);
      html += renderRow("Engagement", escapeHtml(eng));
    }

    if (c.company_size_preference) {
      const csz = Array.isArray(c.company_size_preference)
        ? c.company_size_preference.map(titleize).join(" &middot; ")
        : titleize(c.company_size_preference);
      html += renderRow("Company size", escapeHtml(csz));
    }

    if (c.past_work_highlight) {
      html += renderRow("Past work", escapeHtml(c.past_work_highlight));
    }

    /* Rate &ndash; only render if user did NOT mark "discuss privately" AND
       provided at least one bound */
    if (!c.rate_discuss_privately && (c.rate_min || c.rate_max)) {
      const cur = c.rate_currency || "INR";
      const unit = c.rate_unit ? " / " + titleize(c.rate_unit) : "";
      let rateStr = "";
      if (c.rate_min && c.rate_max) {
        rateStr = cur + " " + c.rate_min + " &ndash; " + c.rate_max + unit;
      } else if (c.rate_min) {
        rateStr = "From " + cur + " " + c.rate_min + unit;
      } else if (c.rate_max) {
        rateStr = "Up to " + cur + " " + c.rate_max + unit;
      }
      if (rateStr) html += renderRow("Rate", escapeHtml(rateStr));
    } else if (c.rate_discuss_privately) {
      html += renderRow("Rate", '<span style="color:var(--text-soft)">Discussed privately</span>');
    }

    if (html) {
      block.innerHTML = html;
      show("ppConsSection");
    }
  }

  /* -- MENTORSHIP -------------------------------------------- */
  function renderMentorship(p) {
    const m = p.mentorship;
    if (!m) return;
    const roles = Array.isArray(m.roles) ? m.roles : [];
    if (!roles.length) return;

    const block = document.getElementById("ppMentBlock");
    block.innerHTML = "";

    /* If user is a mentor, render mentor_profile (only if show_on_profile) */
    const isMentor = roles.indexOf("mentor") !== -1;
    const mp = m.mentor_profile || {};

    if (isMentor && mp.show_on_profile) {
      let html = "";
      if (mp.bio) {
        html += '<div class="pp-block__intro">' + escapeHtml(mp.bio) + '</div>';
      }
      function row(label, val) {
        if (!val) return;
        html += '<div class="pp-block__row">' +
                '<div class="pp-block__label">' + escapeHtml(label) + '</div>' +
                '<div class="pp-block__value">' + escapeHtml(val) + '</div>' +
                '</div>';
      }
      if (mp.speciality) row("Speciality", mp.speciality);
      if (mp.years_experience) row("Experience", mp.years_experience + " years");
      if (mp.target_audience) row("Mentors", mp.target_audience);
      if (mp.fee) row("Fee", mp.fee);
      if (mp.certification) row("Certification", mp.certification);
      if (html) {
        block.innerHTML = html;
        show("ppMentSection");
        return;
      }
    }

    /* Fallback: just say they're a mentor, no details (still useful) */
    if (isMentor) {
      block.innerHTML =
        '<div class="pp-block__intro" style="color:var(--text-soft)">Open to mentoring others. Reach out via the contact button below to learn more.</div>';
      show("ppMentSection");
    }
  }

  /* -- Open Graph -------------------------------------------- */
  function setPageMeta(p) {
    const title = (p.name || "Profile") + " &ndash; MECULS";
    document.title = title;
    const ogT = document.getElementById("ogTitle");
    const ogD = document.getElementById("ogDesc");
    const ogI = document.getElementById("ogImage");
    if (ogT) ogT.setAttribute("content", title);
    if (ogD) ogD.setAttribute("content",
      (p.introduction && p.introduction.headline) ||
      "A professional profile on MECULS.");
    if (ogI && p.photo_path) {
      const ogPhotoUrl = buildPhotoUrl(p.photo_path);
      if (ogPhotoUrl) ogI.setAttribute("content", ogPhotoUrl);
    }
  }

  /* -- LOAD -------------------------------------------------- */
  async function loadProfile() {
    const slug = getSlug();
    if (!slug) {
      hide("ppLoading");
      show("ppNotFound");
      return;
    }

    if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined") {
      console.error("[p.html] config.js not loaded");
      hide("ppLoading");
      show("ppNotFound");
      return;
    }

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    /* Visibility pre-check (Round 8): the user can mark their profile
       private from Settings ? Visibility. If the slug exists but
       is_public is false, show the private state without ever
       fetching the full data. is_profile_public returns:
         - true  ? render normally
         - false ? owner has set is_public = false, show private state
         - null  ? slug not found, show not-found state
       If the RPC itself errors (e.g. function not yet deployed),
       we skip the check and fall through to get_public_profile.
       This keeps the page working even if the SQL hasn't been run. */
    try {
      const { data: vis, error: visErr } = await sb.rpc("is_profile_public", { p_slug: slug });
      if (!visErr) {
        if (vis === false) {
          hide("ppLoading");
          show("ppPrivate");
          return;
        }
        if (vis === null) {
          hide("ppLoading");
          show("ppNotFound");
          return;
        }
      }
    } catch (e) {
      /* Function not deployed yet &ndash; silently fall through */
      console.warn("[p.html] is_profile_public unavailable, skipping visibility check");
    }

    const { data, error } = await sb.rpc("get_public_profile", { p_slug: slug });

    if (error) {
      console.error("[p.html] RPC error:", error);
      hide("ppLoading");
      show("ppNotFound");
      return;
    }

    if (!data) {
      hide("ppLoading");
      show("ppNotFound");
      return;
    }

    if (data.publishable === false) {
      hide("ppLoading");
      setText("ppPendingMsg",
        (data.name || "This member") + " is still completing their profile. Check back soon.");
      if (data.missing && typeof data.missing === "object") {
        const m = data.missing;
        const map = {
          pcPhoto:    m.photo,
          pcCategory: m.profile_category,
          pcIntro:    m.introduction,
          pcExpOrEdu: m.experience_or_education
        };
        Object.keys(map).forEach(function (id) {
          const el = document.getElementById(id);
          if (!el) return;
          el.classList.toggle("done", !map[id]);
        });
        const list = document.getElementById("ppPendingChecklist");
        if (list) list.hidden = false;
      }
      show("ppPending");
      return;
    }

    setPageMeta(data);
    renderHero(data);
    renderBio(data);
    renderExperience(data);
    renderEducation(data);
    renderSkills(data);
    renderAchievements(data);
    renderCertifications(data);
    renderPublications(data);
    renderPortfolio(data);
    renderVolunteering(data);
    renderLanguages(data);
    renderLinks(data);
    renderConsulting(data);
    renderMentorship(data);

    /* Personalise the contact CTA &ndash; "Message Rajneesh" reads warmer
       than the generic "Send a message". */
    customiseCta(data);

    /* Emit JSON-LD Person schema for SEO + Google "About" cards.
       Uses public fields only &ndash; no PII like email or phone. */
    emitJsonLd(data);

    hide("ppLoading");
    show("ppContent");

    /* Switch main from single-column (states) to 2-column grid
       (sticky nav + content) and build the nav rail entries. */
    const main = document.getElementById("ppMain");
    if (main) main.classList.remove("pp-main--single");
    buildNavRail();
  }

  /* -- Build sticky in-page nav from visible sections -------- */
  function buildNavRail() {
    /* Section ID ? label mapping. Renders only sections that are
       actually visible (the renderXxx functions show their parent
       <section> when content exists). */
    const map = [
      { id: "ppBioSection",    label: "About" },
      { id: "ppExpSection",    label: "Experience" },
      { id: "ppEduSection",    label: "Education" },
      { id: "ppSkillsSection", label: "Skills" },
      { id: "ppAchSection",    label: "Key Achievements" },
      { id: "ppCertSection",   label: "Certifications" },
      { id: "ppPubSection",    label: "Publications" },
      { id: "ppPortSection",   label: "Portfolio" },
      { id: "ppVolSection",    label: "Volunteering" },
      { id: "ppLangSection",   label: "Languages" },
      { id: "ppLinksSection",  label: "Links" },
      { id: "ppConsSection",   label: "Consulting" },
      { id: "ppMentSection",   label: "Mentorship" }
    ];

    const visible = map.filter(function (m) {
      const el = document.getElementById(m.id);
      return el && !el.hidden;
    });

    /* Nav only makes sense with 3+ sections &ndash; otherwise it just
       takes up space alongside a short profile. */
    if (visible.length < 3) return;

    const list = document.getElementById("ppNavRailList");
    const rail = document.getElementById("ppNavRail");
    if (!list || !rail) return;

    list.innerHTML = "";
    visible.forEach(function (m) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "pp-nav-rail__link";
      a.href = "#" + m.id;
      a.textContent = m.label;
      a.setAttribute("data-target", m.id);
      a.addEventListener("click", function (e) {
        e.preventDefault();
        const target = document.getElementById(m.id);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      li.appendChild(a);
      list.appendChild(li);
    });
    rail.hidden = false;

    /* Scroll-spy &ndash; highlight the currently-in-view section */
    const links = list.querySelectorAll(".pp-nav-rail__link");
    const linksByTarget = {};
    links.forEach(function (a) {
      linksByTarget[a.getAttribute("data-target")] = a;
    });

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            links.forEach(function (a) { a.classList.remove("is-active"); });
            const a = linksByTarget[entry.target.id];
            if (a) a.classList.add("is-active");
          }
        });
      }, { rootMargin: "-30% 0px -55% 0px", threshold: 0 });
      visible.forEach(function (m) {
        const el = document.getElementById(m.id);
        if (el) observer.observe(el);
      });
    }
  }

  /* -- Personalise contact CTA &ndash; "Message Rajneesh" ---------- */
  function customiseCta(p) {
    const link = document.getElementById("ppContactLink");
    const sub  = document.getElementById("ppCtaSub");
    if (!p.name) return;
    const firstName = String(p.name).trim().split(/\s+/)[0];
    if (link && firstName) {
      link.textContent = "Message " + firstName;
    }
    if (sub) {
      sub.textContent = "Send a message via MECULS &ndash; we'll forward it to " +
        (firstName || "this member") + ".";
    }
  }

  /* -- JSON-LD Person schema --------------------------------- */
  function emitJsonLd(p) {
    const intro = p.introduction || {};
    let mostRecentCompany = "";
    if (Array.isArray(p.experiences) && p.experiences.length) {
      const sorted = p.experiences.slice().sort(function (a, b) {
        if (a.is_current && !b.is_current) return -1;
        if (b.is_current && !a.is_current) return 1;
        return (b.experience_number || 0) - (a.experience_number || 0);
      });
      mostRecentCompany = (sorted[0] && sorted[0].company_name) || "";
    }

    const schema = {
      "@context": "https://schema.org",
      "@type": "Person",
      "name": p.name || "",
      "url": window.location.href
    };
    if (intro.headline)         schema.description = intro.headline;
    if (intro.current_position) schema.jobTitle    = intro.current_position;
    if (mostRecentCompany)      schema.worksFor    = { "@type": "Organization", "name": mostRecentCompany };
    if (p.photo_path) {
      const photoUrl = buildPhotoUrl(p.photo_path);
      if (photoUrl) schema.image = photoUrl;
    }
    if (intro.res_state || intro.res_country) {
      schema.address = {
        "@type": "PostalAddress",
        "addressRegion":  intro.res_state || undefined,
        "addressCountry": intro.res_country || undefined
      };
    }

    const tag = document.createElement("script");
    tag.type = "application/ld+json";
    tag.textContent = JSON.stringify(schema);
    document.head.appendChild(tag);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadProfile);
  } else {
    loadProfile();
  }
})();
