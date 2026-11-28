package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func get(t *testing.T, url string) (*http.Response, string) {
	t.Helper()
	r, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return r, string(b)
}

func TestServerAndSecondInstance(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir()) // dataDir() во временной папке
	opened := make(chan *hostFile, 1)
	ln, existing, err := listen(false)
	if err != nil || existing != "" {
		t.Fatalf("listen: %v %q", err, existing)
	}
	srv := startServer(ln, func(f *hostFile) { opened <- f })
	defer srv.close()

	r, body := get(t, srv.url)
	if r.StatusCode != 200 || !strings.Contains(body, "<html") || r.Header.Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("index.html: %d %q", r.StatusCode, r.Header.Get("Content-Type"))
	}
	if r.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("нет Cache-Control: no-store")
	}
	r, body = get(t, srv.url+"app.js")
	if r.StatusCode != 200 || r.Header.Get("Content-Type") != "text/javascript; charset=utf-8" || !strings.Contains(body, "APP_VERSION") {
		t.Fatalf("app.js: %d %q", r.StatusCode, r.Header.Get("Content-Type"))
	}
	if r, _ = get(t, srv.url+"../server.go"); r.StatusCode != 404 {
		t.Fatalf("выход из папки web: %d", r.StatusCode)
	}
	if r, _ = get(t, srv.url+"нет-такого.js"); r.StatusCode != 404 {
		t.Fatalf("нет файла: %d", r.StatusCode)
	}
	if _, body = get(t, srv.url+"__hl/ping"); body != pingID() {
		t.Fatalf("ping: %q", body)
	}

	// второй запуск той же версии находит первую копию и передаёт ей файл
	ln2, addr, err := listen(false)
	if err != nil || ln2 != nil || addr != ln.Addr().String() {
		t.Fatalf("второй запуск должен найти первый: %v %v %q", err, ln2, addr)
	}
	tmp := filepath.Join(t.TempDir(), "расчёт.hlc")
	if err := os.WriteFile(tmp, []byte(`{"format":"halflife-calc"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if fileArg([]string{"--x", "нет.hlc", tmp}) != tmp {
		t.Fatal("fileArg не нашёл файл")
	}
	f, err := readHostFile(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if err := forwardOpen(addr, f); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-opened:
		if got == nil || got.Name != "расчёт.hlc" || got.Text != `{"format":"halflife-calc"}` {
			t.Fatalf("передан не тот файл: %+v", got)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("файл не дошёл")
	}

	// без ключа из папки программы чужая страница или программа файл не передаст
	resp, err := http.Post(srv.url+"__hl/open", "application/json", strings.NewReader(`{"token":"x","file":null}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("чужой ключ: %d", resp.StatusCode)
	}

	// если передать не удалось — занимаем следующий порт
	ln3, ex3, err := listen(true)
	if err != nil || ex3 != "" || ln3 == nil || ln3.Addr().String() == ln.Addr().String() {
		t.Fatalf("следующий порт: %v %q", err, ex3)
	}
	ln3.Close()
}

func TestExcelAsBase64(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "таблица.xlsx")
	if err := os.WriteFile(tmp, []byte{'P', 'K', 3, 4}, 0o644); err != nil {
		t.Fatal(err)
	}
	f, err := readHostFile(tmp)
	if err != nil || f.B64 != "UEsDBA==" || f.Text != "" {
		t.Fatalf("xlsx: %+v %v", f, err)
	}
}
