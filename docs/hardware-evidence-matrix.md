<!-- SPDX-License-Identifier: CC-BY-SA-4.0 -->
# 硬件证据矩阵

| Plugin | Device model | VID/PID | Firmware | Connection | Feature | Read | Write | Readback | Evidence | Verifier | Date | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mira.amaster | AM INFINITY MOUSE .100 | 3151:5007 | not reported | 2.4 GHz receiver | Protocol A 身份、电池、DPI、轮询率、休眠时间、鼠标灯光、接收器灯光 | yes | 已声明有界写入；当前设备冒烟测试待鼠标在线时进行 | 已声明字段的工作流回读；最近一次本地运行未连接匹配的 HID 设备 | 硬件验证的读取路径，外加由源码/fixture 支撑的有界写入 | local signed-package workflow | 2026-06-26 | 包验证通过；最近一次运行未连接真机硬件 |
| mira.logitech-hidpp | G705 鼠标，验证样本，非白名单 | 046d:c547 | not reported | Lightspeed receiver | HID++ 身份、电池、DPI、回报率、板载配置、灯光 | yes | DPI 1800→1850→1800; 500→1000→500 Hz; red→green→red | 每次写入后完整的 255 字节扇区与 CRC | protocol-verified | local signed-package workflow | 2026-06-21 | 通过；最终 CRC 恢复为 0x02d5 |

空字段或未知字段绝不构成兼容性声明的授权依据。
