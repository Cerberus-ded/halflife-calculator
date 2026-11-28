//go:build windows

// Окно программы: WebView2 (движок Microsoft Edge, есть в Windows 10/11) показывает встроенную веб-версию.
// Мост со страницей — bridge.js: системные диалоги «Открыть» и «Сохранить», заголовок окна, вопрос
// о несохранённых изменениях при закрытии, ссылки в браузере, загрузка обновления данных IAEA.
package main

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf16"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

//go:embed selftest.js
var selfTestJS string

const (
	product          = "Калькулятор полураспада"
	webview2Download = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	comdlg32 = windows.NewLazySystemDLL("comdlg32.dll")

	pSetWindowLongPtrW        = user32.NewProc("SetWindowLongPtrW")
	pCallWindowProcW          = user32.NewProc("CallWindowProcW")
	pPostMessageW             = user32.NewProc("PostMessageW")
	pSetForegroundWindow      = user32.NewProc("SetForegroundWindow")
	pShowWindow               = user32.NewProc("ShowWindow")
	pIsIconic                 = user32.NewProc("IsIconic")
	pFindWindowW              = user32.NewProc("FindWindowW")
	pAllowSetForegroundWindow = user32.NewProc("AllowSetForegroundWindow")
	pGetDpiForSystem          = user32.NewProc("GetDpiForSystem")
	pSystemParametersInfoW    = user32.NewProc("SystemParametersInfoW")
	pGetOpenFileNameW         = comdlg32.NewProc("GetOpenFileNameW")
	pGetSaveFileNameW         = comdlg32.NewProc("GetSaveFileNameW")
	pCommDlgExtendedError     = comdlg32.NewProc("CommDlgExtendedError")
)

const (
	wmClose        = 0x0010
	gwlpWndProc    = ^uintptr(3) // GWLP_WNDPROC = -4
	swHide         = 0
	swShowNormal   = 1
	swRestore      = 9
	asfwAny        = uintptr(0xFFFFFFFF)
	spiGetWorkArea = 0x0030

	mbOK          = 0x0
	mbYesNoCancel = 0x3
	mbIconWarning = 0x30
	mbIconInfo    = 0x40
	idYes         = 6
	idNo          = 7

	ofnOverwritePrompt = 0x2
	ofnHideReadOnly    = 0x4
	ofnNoChangeDir     = 0x8
	ofnPathMustExist   = 0x800
	ofnFileMustExist   = 0x1000
	ofnExplorer        = 0x80000
)

// Окно и WebView2 живут в главном потоке.
func init() { runtime.LockOSThread() }

type options struct {
	file     string
	selfTest string        // --selftest out.json — самопроверка (GitHub Actions)
	hold     time.Duration // --hold 20 — сколько секунд держать окно после самопроверки
}

func parseArgs(a []string) options {
	o := options{hold: 3 * time.Second}
	var rest []string
	for i := 0; i < len(a); i++ {
		switch a[i] {
		case "--selftest":
			if i+1 < len(a) {
				o.selfTest, _ = filepath.Abs(a[i+1])
				i++
			}
		case "--hold":
			if i+1 < len(a) {
				if d, err := time.ParseDuration(a[i+1] + "s"); err == nil {
					o.hold = d
				}
				i++
			}
		default:
			rest = append(rest, a[i])
		}
	}
	o.file = fileArg(rest)
	return o
}

func main() {
	opt := parseArgs(os.Args[1:])
	var start *hostFile
	if opt.file != "" {
		f, err := readHostFile(opt.file)
		if err != nil {
			msgBox(0, "Не удалось открыть файл\n"+opt.file+"\n\n"+err.Error(), mbIconWarning)
		} else {
			start = f
		}
	}

	ln, existing, err := listen(opt.selfTest != "")
	if existing != "" {
		// программа уже открыта: передаём ей файл и показываем её окно
		_, _, _ = pAllowSetForegroundWindow.Call(asfwAny)
		if forwardOpen(existing, start) == nil {
			return
		}
		ln, _, err = listen(true)
	}
	if err != nil {
		msgBox(0, "Не удалось запустить программу: "+err.Error(), mbIconWarning)
		os.Exit(1)
	}
	if lf, e := os.Create(filepath.Join(dataDir(), "halflife-calc.log")); e == nil {
		log.SetOutput(lf)
		defer lf.Close()
	}
	log.Printf("%s %s, адрес %s", appID, version, ln.Addr())

	h := &host{opt: opt, start: start}
	h.srv = startServer(ln, h.openFromOther)
	defer h.srv.close()
	ok := h.run()
	if opt.selfTest != "" && !ok {
		h.srv.close()
		os.Exit(1)
	}
}

type host struct {
	w    webview2.WebView
	hwnd uintptr
	srv  *server
	opt  options

	mu       sync.Mutex
	start    *hostFile   // файл из командной строки — отдаётся странице, когда она готова
	pending  []*hostFile // файлы от второго запуска, пришедшие до готовности страницы
	ready    bool
	selfTest bool // самопроверка уже запущена

	oldProc    uintptr
	forceClose atomic.Bool
	closeAck   atomic.Bool
	selfOK     atomic.Bool
	lastDir    string
}

var theHost *host

func (h *host) run() bool {
	width, height, minW, minH := windowSize()
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:      filepath.Join(dataDir(), "WebView2"),
		AutoFocus:     true,
		WindowOptions: webview2.WindowOptions{Title: product, Width: uint(width), Height: uint(height), IconId: 1, Center: true},
	})
	if w == nil {
		log.Println("WebView2 не запустился")
		h.noWebView()
		return false
	}
	defer w.Destroy()
	h.w = w
	h.hwnd = uintptr(w.Window())
	w.SetSize(minW, minH, webview2.HintMin)
	h.bind()
	w.Init(bridgeJS)
	if h.opt.selfTest != "" {
		w.Init("window.__hlSelfDir = " + jsString(filepath.Dir(h.opt.selfTest)) + ";")
		time.AfterFunc(120*time.Second, func() {
			h.writeSelfTest("", `{"ok":false,"error":"нет ответа страницы за 120 с"}`)
			os.Exit(2)
		})
	}
	h.subclass()
	w.Navigate(h.srv.url)
	w.Run()
	return h.selfOK.Load()
}

// windowSize — 1280×840 с учётом масштаба экрана, но не больше рабочей области.
func windowSize() (w, h, minW, minH int) {
	dpi := 96
	if pGetDpiForSystem.Find() == nil {
		if r, _, _ := pGetDpiForSystem.Call(); r > 0 {
			dpi = int(r)
		}
	}
	sc := func(v int) int { return v * dpi / 96 }
	w, h = sc(1280), sc(840)
	var rc struct{ L, T, R, B int32 }
	if r, _, _ := pSystemParametersInfoW.Call(spiGetWorkArea, 0, uintptr(unsafe.Pointer(&rc)), 0); r != 0 {
		if aw := int(rc.R-rc.L) * 94 / 100; aw > 0 && w > aw {
			w = aw
		}
		if ah := int(rc.B-rc.T) * 94 / 100; ah > 0 && h > ah {
			h = ah
		}
	}
	return w, h, sc(360), sc(480)
}

func jsString(v interface{}) string { b, _ := json.Marshal(v); return string(b) }

func (h *host) bind() {
	w := h.w
	must := func(err error) {
		if err != nil {
			log.Println("bind:", err)
		}
	}
	must(w.Bind("hlState", func(s map[string]interface{}) {
		if t, ok := s["title"].(string); ok && strings.TrimSpace(t) != "" {
			w.SetTitle(t)
		}
	}))
	must(w.Bind("hlReady", h.pageReady))
	must(w.Bind("hlOpenFile", func(id int) { w.Dispatch(func() { h.openDialog(id) }) }))
	must(w.Bind("hlSaveFile", func(id int, o saveOpts) { w.Dispatch(func() { h.saveDialog(id, o) }) }))
	must(w.Bind("hlFetchText", func(id int, u string) { go h.fetchText(id, u) }))
	must(w.Bind("hlCloseAck", func() { h.closeAck.Store(true) }))
	must(w.Bind("hlCloseNow", func() { w.Dispatch(h.closeWindow) }))
	must(w.Bind("hlOpenUrl", func(u string) { openURL(u) }))
	if h.opt.selfTest != "" {
		must(w.Bind("hlSelfTest", h.selfTestResult))
	}
}

// done отвечает странице на долгий вызов (window.__hlDone). Только из главного потока.
func (h *host) done(id int, ok bool, v interface{}) {
	h.w.Eval(fmt.Sprintf("window.__hlDone && window.__hlDone(%d,%t,%s)", id, ok, jsString(v)))
}

func (h *host) evalOpen(f *hostFile) {
	h.w.Eval("window.__hlOpen && window.__hlOpen(" + jsString(f) + ")")
}

func (h *host) pageReady() {
	h.mu.Lock()
	files := h.pending
	h.pending = nil
	if h.start != nil {
		files = append([]*hostFile{h.start}, files...)
		h.start = nil
	}
	h.ready = true
	runSelf := h.opt.selfTest != "" && !h.selfTest
	h.selfTest = h.selfTest || runSelf
	h.mu.Unlock()
	h.w.Dispatch(func() {
		if n := len(files); n > 0 {
			h.evalOpen(files[n-1]) // открыть можно один расчёт — последний переданный
		}
		if runSelf {
			h.w.Eval(selfTestJS)
		}
	})
}

// openFromOther — второй запуск программы передал файл (или просто просит показать окно). Поток сервера.
func (h *host) openFromOther(f *hostFile) {
	h.mu.Lock()
	if !h.ready {
		if f != nil {
			h.pending = append(h.pending, f)
		}
		h.mu.Unlock()
		return
	}
	h.mu.Unlock()
	h.w.Dispatch(func() {
		if r, _, _ := pIsIconic.Call(h.hwnd); r != 0 {
			_, _, _ = pShowWindow.Call(h.hwnd, swRestore)
		}
		_, _, _ = pSetForegroundWindow.Call(h.hwnd)
		if f != nil {
			h.evalOpen(f)
			if h.opt.selfTest != "" {
				time.AfterFunc(2*time.Second, func() {
					h.w.Dispatch(func() { h.w.Eval(`window.hlSelfTest("open", JSON.stringify(App.snapshot()))`) })
				})
			}
		}
	})
}

// ---------- закрытие окна ----------

func wndProc(hwnd, msg, wp, lp uintptr) uintptr {
	h := theHost
	if msg == wmClose && h != nil && !h.forceClose.Load() {
		h.requestClose()
		return 0
	}
	r, _, _ := pCallWindowProcW.Call(h.oldProc, hwnd, msg, wp, lp)
	return r
}

func (h *host) subclass() {
	theHost = h
	h.oldProc, _, _ = pSetWindowLongPtrW.Call(h.hwnd, gwlpWndProc, windows.NewCallback(wndProc))
}

// requestClose: страница спрашивает о несохранённых изменениях и закрывает окно сама. Если она не ответила
// за 2 секунды (ещё не загрузилась или зависла), окно закрывается без вопроса.
func (h *host) requestClose() {
	h.closeAck.Store(false)
	h.w.Eval("window.__hlClose ? window.__hlClose() : (window.hlCloseNow && window.hlCloseNow())")
	time.AfterFunc(2*time.Second, func() {
		if !h.closeAck.Load() {
			h.w.Dispatch(h.closeWindow)
		}
	})
}

func (h *host) closeWindow() {
	h.forceClose.Store(true)
	_, _, _ = pPostMessageW.Call(h.hwnd, wmClose, 0, 0)
}

// ---------- файлы ----------

type filter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}

type saveOpts struct {
	Path          string   `json:"path"`
	SuggestedName string   `json:"suggestedName"`
	Filters       []filter `json:"filters"`
	Text          string   `json:"text"`
	B64           string   `json:"b64"`
	IsText        bool     `json:"isText"`
}

var openFilters = []filter{
	{"Расчёт и формулы", []string{"hlc", "mpl", "tex", "py", "txt", "csv", "tsv", "xlsx"}},
	{"Расчёт полураспада", []string{"hlc"}},
	{"Формулы (Maple, LaTeX, Python, текст, CSV, Excel)", []string{"mpl", "tex", "py", "txt", "csv", "tsv", "xlsx"}},
	{"JSON", []string{"json"}},
	{"Все файлы", []string{"*"}},
}

type openFileNameW struct {
	lStructSize       uint32
	hwndOwner         uintptr
	hInstance         uintptr
	lpstrFilter       *uint16
	lpstrCustomFilter *uint16
	nMaxCustFilter    uint32
	nFilterIndex      uint32
	lpstrFile         *uint16
	nMaxFile          uint32
	lpstrFileTitle    *uint16
	nMaxFileTitle     uint32
	lpstrInitialDir   *uint16
	lpstrTitle        *uint16
	flags             uint32
	nFileOffset       uint16
	nFileExtension    uint16
	lpstrDefExt       *uint16
	lCustData         uintptr
	lpfnHook          uintptr
	lpTemplateName    *uint16
	pvReserved        uintptr
	dwReserved        uint32
	flagsEx           uint32
}

// utf16z — строка UTF-16 с нулём в конце; нули внутри (разделители фильтра) сохраняются.
func utf16z(s string) []uint16 { return append(utf16.Encode([]rune(s)), 0) }

func filterString(fs []filter) []uint16 {
	var b strings.Builder
	for _, f := range fs {
		var pats []string
		for _, e := range f.Extensions {
			e = strings.TrimPrefix(strings.TrimSpace(e), ".")
			if e == "" || e == "*" {
				pats = append(pats, "*.*")
			} else {
				pats = append(pats, "*."+e)
			}
		}
		if len(pats) == 0 {
			continue
		}
		p := strings.Join(pats, ";")
		name := f.Name
		if name == "" {
			name = strings.ToUpper(strings.TrimPrefix(pats[0], "*."))
		}
		if p != "*.*" && len(pats) <= 3 {
			name += " (" + p + ")"
		}
		b.WriteString(name)
		b.WriteByte(0)
		b.WriteString(p)
		b.WriteByte(0)
	}
	return utf16z(b.String()) // список кончается двумя нулями
}

func safeName(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`<>:"/\|?*`, r) {
			return '_'
		}
		return r
	}, s)
}

func (h *host) initialDir() string {
	if h.lastDir != "" {
		return h.lastDir
	}
	if d, err := windows.KnownFolderPath(windows.FOLDERID_Documents, 0); err == nil {
		return d
	}
	return ""
}

// fileDialog показывает системный диалог; "" без ошибки — пользователь нажал «Отмена».
func (h *host) fileDialog(save bool, title string, fs []filter, suggested, defExt string) (string, error) {
	buf := make([]uint16, 32768)
	if suggested != "" {
		copy(buf[:len(buf)-1], utf16.Encode([]rune(safeName(suggested))))
	}
	flt := filterString(fs)
	ttl := utf16z(title)
	dir := utf16z(h.initialDir())
	ofn := openFileNameW{
		hwndOwner: h.hwnd, lpstrFilter: &flt[0], nFilterIndex: 1,
		lpstrFile: &buf[0], nMaxFile: uint32(len(buf)), lpstrTitle: &ttl[0], lpstrInitialDir: &dir[0],
		flags: ofnExplorer | ofnNoChangeDir | ofnPathMustExist | ofnHideReadOnly,
	}
	ofn.lStructSize = uint32(unsafe.Sizeof(ofn))
	var ext []uint16
	if defExt != "" {
		ext = utf16z(defExt)
		ofn.lpstrDefExt = &ext[0]
	}
	proc := pGetOpenFileNameW
	if save {
		proc = pGetSaveFileNameW
		ofn.flags |= ofnOverwritePrompt
	} else {
		ofn.flags |= ofnFileMustExist
	}
	r, _, _ := proc.Call(uintptr(unsafe.Pointer(&ofn)))
	runtime.KeepAlive(buf)
	runtime.KeepAlive(flt)
	runtime.KeepAlive(ttl)
	runtime.KeepAlive(dir)
	runtime.KeepAlive(ext)
	if r == 0 {
		if e, _, _ := pCommDlgExtendedError.Call(); e != 0 {
			return "", fmt.Errorf("ошибка диалога Windows %#x", e)
		}
		return "", nil
	}
	return windows.UTF16ToString(buf), nil
}

func (h *host) openDialog(id int) {
	defer h.w.Dispatch(func() {}) // разбудить очередь: просьбы страницы во время диалога могли ждать
	p, err := h.fileDialog(false, "Открыть расчёт или формулы", openFilters, "", "")
	if err != nil {
		h.done(id, false, err.Error())
		return
	}
	if p == "" {
		h.done(id, true, nil)
		return
	}
	f, err := readHostFile(p)
	if err != nil {
		h.done(id, false, "Не удалось открыть "+p+": "+err.Error())
		return
	}
	h.lastDir = filepath.Dir(p)
	h.done(id, true, f)
}

func (h *host) saveDialog(id int, o saveOpts) {
	defer h.w.Dispatch(func() {})
	target := o.Path
	if target == "" {
		defExt := ""
		if len(o.Filters) > 0 && len(o.Filters[0].Extensions) > 0 {
			defExt = strings.TrimPrefix(o.Filters[0].Extensions[0], ".")
		}
		fs := append(append([]filter{}, o.Filters...), filter{"Все файлы", []string{"*"}})
		p, err := h.fileDialog(true, "Сохранить", fs, o.SuggestedName, defExt)
		if err != nil {
			h.done(id, false, err.Error())
			return
		}
		if p == "" {
			h.done(id, true, nil)
			return
		}
		target = p
	}
	data := []byte(o.Text)
	if !o.IsText {
		var err error
		if data, err = base64.StdEncoding.DecodeString(o.B64); err != nil {
			h.done(id, false, "Повреждённые данные: "+err.Error())
			return
		}
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		h.done(id, false, "Не удалось сохранить "+target+": "+err.Error())
		return
	}
	h.lastDir = filepath.Dir(target)
	h.done(id, true, map[string]string{"path": target, "name": filepath.Base(target)})
}

// fetchText — выгрузка IAEA LiveChart для «Данные → Обновить данные IAEA»; другие адреса не разрешены.
func (h *host) fetchText(id int, u string) {
	reply := func(ok bool, v interface{}) { h.w.Dispatch(func() { h.done(id, ok, v) }) }
	if !strings.HasPrefix(u, "https://www-nds.iaea.org/") {
		reply(false, "Адрес не разрешён")
		return
	}
	c := http.Client{Timeout: 60 * time.Second}
	r, err := c.Get(u)
	if err != nil {
		reply(false, "Нет связи с IAEA: "+err.Error())
		return
	}
	defer r.Body.Close()
	if r.StatusCode != http.StatusOK {
		reply(false, fmt.Sprintf("HTTP %d", r.StatusCode))
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, maxFile))
	if err != nil {
		reply(false, err.Error())
		return
	}
	reply(true, string(b))
}

func openURL(u string) {
	x, err := url.Parse(u)
	if err != nil || (x.Scheme != "https" && x.Scheme != "http") {
		return
	}
	verb, _ := windows.UTF16PtrFromString("open")
	target, err := windows.UTF16PtrFromString(x.String())
	if err != nil {
		return
	}
	_ = windows.ShellExecute(0, verb, target, nil, nil, swShowNormal)
}

func msgBox(hwnd uintptr, text string, flags uint32) int32 {
	t, _ := windows.UTF16PtrFromString(strings.ReplaceAll(text, "\x00", ""))
	c, _ := windows.UTF16PtrFromString(product)
	r, _ := windows.MessageBox(windows.HWND(hwnd), t, c, flags)
	return r
}

// noWebView — на компьютере нет WebView2 (бывает на старой Windows 10 без обновлений).
func (h *host) noWebView() {
	if h.opt.selfTest != "" {
		h.writeSelfTest("", `{"ok":false,"error":"WebView2 не найден"}`)
		return
	}
	// библиотека уже показала пустое окно — прячем его
	if cls, err := windows.UTF16PtrFromString("webview"); err == nil {
		if wnd, _, _ := pFindWindowW.Call(uintptr(unsafe.Pointer(cls)), 0); wnd != 0 {
			_, _, _ = pShowWindow.Call(wnd, swHide)
		}
	}
	r := msgBox(0, "Для окна программы нужен компонент Microsoft Edge WebView2. Он входит в Windows 11 и в обновлённую "+
		"Windows 10, а на этом компьютере не найден.\n\n"+
		"Да — открыть калькулятор в браузере (всё работает так же).\n"+
		"Нет — скачать WebView2 с сайта Microsoft (бесплатно), установить и запустить программу снова.\n"+
		"Отмена — выйти.", mbYesNoCancel|mbIconWarning)
	switch r {
	case idYes:
		openURL(h.srv.url)
		msgBox(0, "Калькулятор открыт в браузере.\n\nНе закрывайте это окно, пока работаете. Когда закончите, нажмите ОК.", mbOK|mbIconInfo)
	case idNo:
		openURL(webview2Download)
	}
}

// ---------- самопроверка (GitHub Actions: halflife-calc.exe --selftest out.json --hold 20) ----------

func (h *host) writeSelfTest(kind, data string) {
	p := h.opt.selfTest
	if kind != "" {
		p = strings.TrimSuffix(p, ".json") + "." + kind + ".json"
	}
	_ = os.WriteFile(p, []byte(data), 0o644)
}

func (h *host) selfTestResult(kind, data string) {
	h.writeSelfTest(kind, data)
	if kind == "" {
		var r struct {
			OK bool `json:"ok"`
		}
		_ = json.Unmarshal([]byte(data), &r)
		h.selfOK.Store(r.OK)
		time.AfterFunc(h.opt.hold, func() { h.w.Dispatch(h.closeWindow) })
	}
}
