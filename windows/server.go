// Компактная версия для Windows: веб-версия (папка web/) зашита в exe и отдаётся окну WebView2
// маленьким сервером на 127.0.0.1. Сеть наружу не нужна, порт снаружи компьютера не виден.
//
// Порт постоянный (47811, при занятости — следующие), чтобы у страницы был один и тот же адрес:
// так между запусками сохраняются черновик, недавние расчёты и настройки (localStorage).
// Если программа той же версии уже открыта, второй запуск передаёт ей файл и закрывается.
package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

//go:embed all:web
var webFiles embed.FS

//go:embed bridge.js
var bridgeJS string

// version подставляет сборка: -ldflags "-X main.version=1.3"
var version = "dev"

const (
	appID     = "halflife-calc"
	basePort  = 47811
	portTries = 10
	maxFile   = 64 << 20 // файлы расчёта и формул — до 64 МБ
)

// Типы файлов задаём сами: на Windows mime.TypeByExtension берёт их из реестра, а там бывает что угодно.
var contentTypes = map[string]string{
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
	".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
}

// hostFile — файл для страницы: текст или, для Excel, байты в base64.
type hostFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Text string `json:"text,omitempty"`
	B64  string `json:"b64,omitempty"`
}

// openExt — что программа открывает при запуске с файлом (как настольная версия Electron).
var openExt = map[string]bool{".hlc": true, ".json": true, ".mpl": true, ".tex": true, ".py": true, ".txt": true, ".csv": true, ".tsv": true, ".xlsx": true}

func readHostFile(p string) (*hostFile, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return nil, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, errors.New("это папка, а не файл")
	}
	if st.Size() > maxFile {
		return nil, errors.New("файл слишком большой")
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	f := &hostFile{Path: abs, Name: filepath.Base(abs)}
	if strings.EqualFold(filepath.Ext(abs), ".xlsx") {
		f.B64 = encodeB64(data)
	} else {
		f.Text = string(data)
	}
	return f, nil
}

// fileArg — первый аргумент командной строки, похожий на файл расчёта или формул.
func fileArg(args []string) string {
	for _, a := range args {
		if strings.HasPrefix(a, "-") {
			continue
		}
		if openExt[strings.ToLower(filepath.Ext(a))] {
			if st, err := os.Stat(a); err == nil && !st.IsDir() {
				return a
			}
		}
	}
	return ""
}

// dataDir — папка программы: %LOCALAPPDATA%\HalflifeCalc (данные WebView2, журнал, сведения о запущенной копии).
func dataDir() string {
	base, err := os.UserCacheDir()
	if err != nil || base == "" {
		base = os.TempDir()
	}
	d := filepath.Join(base, "HalflifeCalc")
	_ = os.MkdirAll(d, 0o755)
	return d
}

type server struct {
	ln     net.Listener
	url    string
	token  string
	onOpen func(*hostFile) // второй запуск передал файл (nil — просто показать окно)
}

func newToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func encodeB64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func pingID() string { return appID + " " + version }

// handler отдаёт файлы веб-версии и служебные адреса /__hl/…
func (s *server) handler() http.Handler {
	sub, err := fs.Sub(webFiles, "web")
	if err != nil {
		panic(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/__hl/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, pingID())
	})
	mux.HandleFunc("/__hl/open", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Token string    `json:"token"`
			File  *hostFile `json:"file"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, maxFile*2)).Decode(&req); err != nil || req.Token == "" || req.Token != s.token {
			http.Error(w, "нет доступа", http.StatusForbidden)
			return
		}
		if s.onOpen != nil {
			s.onOpen(req.File)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "GET", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		data, err := fs.ReadFile(sub, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ct := contentTypes[strings.ToLower(path.Ext(name))]
		if ct == "" {
			ct = "application/octet-stream"
		}
		h := w.Header()
		h.Set("Content-Type", ct)
		h.Set("Cache-Control", "no-store") // новая версия exe — сразу новые файлы, без старого кэша WebView2
		h.Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
	})
	return mux
}

// ping — отвечает ли на адресе эта же программа той же версии.
func ping(addr string) bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	r, err := c.Get("http://" + addr + "/__hl/ping")
	if err != nil {
		return false
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 256))
	return r.StatusCode == http.StatusOK && string(b) == pingID()
}

// listen занимает порт. Если на порту уже работает эта программа той же версии, возвращает её адрес (existing),
// чтобы второй запуск передал ей файл. skipExisting — такие порты пропускать (передать файл не удалось).
func listen(skipExisting bool) (ln net.Listener, existing string, err error) {
	for i := 0; i < portTries; i++ {
		addr := fmt.Sprintf("127.0.0.1:%d", basePort+i)
		if l, e := net.Listen("tcp", addr); e == nil {
			return l, "", nil
		}
		if !skipExisting && ping(addr) {
			return nil, addr, nil
		}
	}
	l, e := net.Listen("tcp", "127.0.0.1:0")
	return l, "", e
}

func instancePath(addr string) string {
	_, port, _ := net.SplitHostPort(addr)
	return filepath.Join(dataDir(), "instance-"+port+".json")
}

type instanceInfo struct {
	Token   string `json:"token"`
	Version string `json:"version"`
	PID     int    `json:"pid"`
}

// start запускает сервер; onOpen вызывается из другого потока.
func startServer(ln net.Listener, onOpen func(*hostFile)) *server {
	s := &server{ln: ln, url: "http://" + ln.Addr().String() + "/", token: newToken(), onOpen: onOpen}
	b, _ := json.Marshal(instanceInfo{Token: s.token, Version: version, PID: os.Getpid()})
	_ = os.WriteFile(instancePath(ln.Addr().String()), b, 0o600)
	go func() { _ = http.Serve(ln, s.handler()) }()
	return s
}

func (s *server) close() {
	_ = os.Remove(instancePath(s.ln.Addr().String()))
	_ = s.ln.Close()
}

// forwardOpen передаёт файл (или просьбу показать окно, f == nil) уже запущенной программе.
func forwardOpen(addr string, f *hostFile) error {
	raw, err := os.ReadFile(instancePath(addr))
	if err != nil {
		return err
	}
	var info instanceInfo
	if err := json.Unmarshal(raw, &info); err != nil || info.Token == "" {
		return errors.New("нет сведений о запущенной программе")
	}
	body, _ := json.Marshal(map[string]interface{}{"token": info.Token, "file": f})
	c := http.Client{Timeout: 5 * time.Second}
	r, err := c.Post("http://"+addr+"/__hl/open", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer r.Body.Close()
	if r.StatusCode != http.StatusNoContent {
		return fmt.Errorf("программа ответила %d", r.StatusCode)
	}
	return nil
}
