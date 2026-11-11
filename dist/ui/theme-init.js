/* 그리기 전에 칠한다. 여기가 아니라 React 안에서 하면 흰 화면이 한 번
         번쩍이고 어두워진다.
         다크 값은 [data-theme="dark"] 한 곳에만 있다. 미디어 쿼리로
         복제하면 같은 색이 두 벌이 되고, 한쪽만 고쳐지는 날이 온다.
         그래서 OS 설정도 여기서 읽어 같은 속성으로 바꿔 준다. */
      (function () {
        try {
          var 고른것 = localStorage.getItem("keynes-theme");
          var 어둡나 =
            !고른것 || 고른것 === "dark" ||
            (고른것 === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
          document.documentElement.setAttribute("data-theme", 어둡나 ? "dark" : "light");
        } catch (e) {
          document.documentElement.setAttribute("data-theme", "dark");
        }
        /* 글자 다듬기를 플랫폼으로 가른다.
           -webkit-font-smoothing: antialiased 는 macOS 를 위한 값이다.
           윈도우 크롬에서는 그것이 ClearType(서브픽셀 렌더링)을 꺼서 한글
           획을 얇고 흐리게 만든다. 125% 배율에서는 획이 소수점 픽셀에
           걸리는데 서브픽셀까지 없으면 뭉개져 보인다 - "울퉁불퉁하다",
           "손으로 그린 것 같다" 가 그것이다.
           그래서 mac 에서만 켠다. 여기서 하는 이유는 CSS 로는 OS 를 못
           가리기 때문이고, 그리기 전에 정해야 한 번 번쩍이지 않기 때문이다. */
        try {
          var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
          if (mac) document.documentElement.setAttribute("data-os", "mac");
        } catch (e) {}
      })();

