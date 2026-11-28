//go:build !windows

// Не Windows: окна нет, только сервер — чтобы проверить сборку и открыть веб-версию в браузере
// (go run . в папке windows/ после bash build.sh). Мост bridge.js браузеру не нужен.
package main

import (
	"fmt"
	"os"
)

func main() {
	ln, existing, err := listen(false)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if existing != "" {
		fmt.Println("уже запущено: http://" + existing + "/")
		return
	}
	srv := startServer(ln, func(f *hostFile) {
		if f != nil {
			fmt.Println("второй запуск передал файл:", f.Name)
		}
	})
	defer srv.close()
	fmt.Println(srv.url)
	select {}
}
