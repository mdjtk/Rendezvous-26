(function () {
  'use strict';
  var SECTIONS = [
    {
      name: 'Minor',
      stages: [
        {
          stage: 'On Stage',
          items: [
            'TARTEEL',
            'ELOCUTION MALAYALAM',
            'ELOCUTION ENGLISH',
            'TALK MASTER ARABIC',
            'GROUP SONG',
            'MADH SONG',
            'TONGUE TALES',
          ],
        },
        {
          stage: 'Off Stage',
          items: [
            'ESSAY MALAYALAM',
            'ESSAY ENGLISH',
            'STORY MALAYALAM',
            'STORY ARABIC',
            'POEM MALAYALAM',
            'PYGMY POEM ENGLISH',
            'BOOK TEST',
            'WRITTEN TRANSLATION ENG-MAL',
            'SUDOKU',
            'WATERCOLORING',
            "IMLA'",
            'HANDWRITING ENGLISH',
            'GRAMMAR MASTERY',
            'MATHS RELAY',
            'SWARF TEST',
            'IBARATH READING',
            'QUIZ',
            'WORD GAME ARABIC (PADHAKKALARI)',
            "HIFZUL QUR'AN",
          ],
        },
      ],
    },
    {
      name: 'Premier',
      stages: [
        {
          stage: 'On Stage',
          items: [
            'ELOCUTION MALAYALAM',
            'ELOCUTION ARABIC',
            'DEVOTIONAL SONG',
            'TALK MASTER ENGLISH',
            'PAPER PRESENTATION ENGLISH',
            'MADH SONG',
            'URUDU POEM RECITATION',
          ],
        },
        {
          stage: 'Off Stage',
          items: [
            'ESSAY MALAYALAM',
            'ESSAY ENGLISH',
            'STORY MALAYALAM',
            'STORY ENGLISH',
            'POEM MALAYALAM',
            'POEM ENGLISH',
            'LETTERVERSE',
            'PYGMY POEM ARABIC',
            'BOOK TEST',
            'WRITTEN TRANSLATION ENG-MAL',
            'VOCABULARY ARABIC',
            'WATERCOLORING',
            'CARTOON SCAPE',
            'CAPTION WRITING',
            'IMLA',
            'HANDWRITING ENGLISH',
            'SUDOKU',
            'QUIZ',
            'NAHV TEST',
            'SWARF TEST',
            'IBARATH READING',
            'HIFZUL MUTHOON',
            "HIFZUL QUR'AN",
          ],
        },
      ],
    },
    {
      name: 'Sub junior',
      stages: [
        {
          stage: 'On Stage',
          items: [
            'PUBLIC TALK ENGLISH',
            'ELOCUTION ARABIC',
            'ELOCUTION MALAYALAM',
            'HAMD UROU',
            'SONG ARABIC',
            'PAPER PRESENTATION ENGLISH',
            'MAPPILAPPATTU',
          ],
        },
        {
          stage: 'Off Stage',
          items: [
            'ESSAY MALAYALAM',
            'ESSAY ENGLISH',
            'ESSAY ARABIC',
            'ESSAY URDU',
            'POEM MALAYALAM',
            'POEM ENGLISH',
            'POEM ARABIC',
            'POEM URDU',
            'STORY MALAYALAM',
            'STORY ENGLISH',
            'STORY ARABIC',
            'STORY URDU',
            'SOCIAL TWEET MALAYALAM',
            'DICTIONARY MAKING ARB-ENG',
            'WRITTEN TRANSLATION MAL-ENG',
            'KITHABIC TEST',
            'BOOK TEST',
            'AD MAKING',
            'IMLA',
            'HIFZUL MUTHOON',
            'QUIZ',
            'SIARF TEST',
            'NAHV TEST',
            'WORD GAME ARABIC (PADHAKKALARI)',
            'IBARATH READING',
            "HIFZUL QUR'AN",
          ],
        },
      ],
    },
    {
      name: 'General',
      stages: [
        {
          stage: 'On Stage',
          items: ['TARTEEL*', 'OAWWALI', 'NASHEEDA', 'GROUP SONG', "NA'AT"],
        },
        { stage: 'Off Stage', items: [] },
      ],
    },
  ];

  function flatFor(section) {
    var out = [];
    section.stages.forEach(function (st) {
      out = out.concat(st.items);
    });
    return out;
  }

  function unique(list) {
    var seen = {};
    var out = [];
    list.forEach(function (n) {
      if (!seen[n]) {
        seen[n] = 1;
        out.push(n);
      }
    });
    return out;
  }

  function findSection(name) {
    var key = String(name || '').toLowerCase().trim();
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].name.toLowerCase() === key) return SECTIONS[i];
    }
    return null;
  }

  window.RV26 = window.RV26 || {};
  window.RV26.PROGRAMS = {
    SECTIONS: SECTIONS,
    all: function () {
      var out = [];
      SECTIONS.forEach(function (s) {
        out = out.concat(flatFor(s));
      });
      return unique(out);
    },
    sections: function () {
      return SECTIONS.map(function (s) {
        return s.name;
      });
    },
    section: findSection,
    forSection: function (name) {
      var s = findSection(name);
      return s ? flatFor(s) : [];
    },
  };
})();