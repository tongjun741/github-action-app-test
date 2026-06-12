# dockur/windows 私有与离线部署

本文说明如何在没有私有 Docker Registry 的情况下，通过 HTTP 文件下载部署
`dockurr/windows`，并使用本地 Windows 7 ISO，避免部署时依赖 Docker Hub 和
外部 ISO 下载源。

## 制品说明

完整部署包含三个相互独立的制品：

1. `dockurr/windows` 容器镜像：提供 QEMU、安装脚本和 Web Viewer，不包含 Windows。
2. Windows 7 ISO：Windows 安装介质，需要自行下载并确认拥有合法授权。
3. `/storage` 数据：Windows 安装完成后生成的虚拟磁盘和运行数据。

仅保存 Docker 镜像不会包含 Windows ISO，也不会包含已经安装好的 Windows 系统。

## 环境要求

- Linux x86_64 主机。
- Docker Engine 和 Docker Compose。
- 主机支持 KVM，并存在 `/dev/kvm`。
- BIOS 中已启用 Intel VT-x 或 AMD-V。
- 如果主机本身是虚拟机，需要启用嵌套虚拟化。
- 建议至少分配 4 核 CPU、8 GB 内存和 80 GB 可用磁盘。

可以使用以下命令检查 KVM：

```bash
test -e /dev/kvm && echo "KVM available" || echo "KVM unavailable"
```

## 一、制作容器镜像下载包

在可以访问 Docker Hub 的 Linux amd64 机器上执行：

```bash
SOURCE_IMAGE="docker.io/dockurr/windows:latest"
LOCAL_IMAGE="local/dockurr-windows:2026-06-12"
ARCHIVE="dockurr-windows-2026-06-12-amd64.tar.gz"

docker pull --platform linux/amd64 "$SOURCE_IMAGE"
docker tag "$SOURCE_IMAGE" "$LOCAL_IMAGE"
docker save "$LOCAL_IMAGE" | gzip -1 > "$ARCHIVE"
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"
```

生成：

```text
dockurr-windows-2026-06-12-amd64.tar.gz
dockurr-windows-2026-06-12-amd64.tar.gz.sha256
```

生产环境不建议长期使用浮动的 `latest`。更新镜像时应使用新的内部版本标签，
重新生成 SHA-256，并先完成测试。

## 二、发布镜像包

将镜像包和校验文件上传到能够通过 HTTP/HTTPS 访问的位置，例如：

- 内部 NAS 或静态文件服务器。
- S3 兼容对象存储。
- 云对象存储。
- 支持大文件的 Release 或下载服务。

示例地址：

```text
https://downloads.example.com/docker/dockurr-windows-2026-06-12-amd64.tar.gz
https://downloads.example.com/docker/dockurr-windows-2026-06-12-amd64.tar.gz.sha256
```

镜像文件可能很大，发布服务必须支持大文件、断点续传和足够的带宽。

### 本仓库工作流的默认约定

`.github/workflows/Windows7-docker.yml` 默认不启用私有部署。手动触发工作流时将
`private_deployment` 设置为 `true` 后，使用以下固定配置：

```text
下载目录：https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows/
镜像包：dockurr-windows-2026-06-12-amd64.tar.gz
镜像校验：dockurr-windows-2026-06-12-amd64.tar.gz.sha256
镜像名称：local/dockurr-windows:2026-06-12
Windows ISO：en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso
```

因此服务器上的默认下载地址为：

```text
https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows/dockurr-windows-2026-06-12-amd64.tar.gz
https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows/dockurr-windows-2026-06-12-amd64.tar.gz.sha256
https://pageload-test.oss-us-east-1.aliyuncs.com/dockurr-windows/en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso
```

镜像包必须由包含 `local/dockurr-windows:2026-06-12` 标签的镜像生成：

```bash
docker pull dockurr/windows:latest
docker tag dockurr/windows:latest local/dockurr-windows:2026-06-12
docker save local/dockurr-windows:2026-06-12 \
  | gzip -1 > dockurr-windows-2026-06-12-amd64.tar.gz
sha256sum dockurr-windows-2026-06-12-amd64.tar.gz \
  > dockurr-windows-2026-06-12-amd64.tar.gz.sha256
```

## 三、目标机器下载并导入镜像

```bash
ARCHIVE="dockurr-windows-2026-06-12-amd64.tar.gz"
BASE_URL="https://downloads.example.com/docker"

curl -fL --retry 5 --retry-delay 5 \
  "$BASE_URL/$ARCHIVE" \
  -o "/tmp/$ARCHIVE"

curl -fL --retry 5 --retry-delay 5 \
  "$BASE_URL/$ARCHIVE.sha256" \
  -o "/tmp/$ARCHIVE.sha256"

cd /tmp
sha256sum -c "$ARCHIVE.sha256"
gzip -dc "$ARCHIVE" | docker load

docker image inspect "local/dockurr-windows:2026-06-12" >/dev/null
```

只有 SHA-256 校验成功后才能执行 `docker load`。

## 四、Windows 7 ISO

当前 `dockur/windows` 源码中，`VERSION: "7u"` 映射为：

```text
Windows 7 Ultimate SP1 x64 English
```

经 2026-06-12 检查可访问的源码镜像地址：

```text
https://files.dog/MSDN/Windows%207/en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso
```

备用地址：

```text
https://archive.org/download/win7-ult-sp1-english/Win7_Ult_SP1_English_x64.iso
```

文件校验信息：

```text
文件大小：3320903680 字节
SHA-256：36f4fa2416d0982697ab106e3a72d2e120dbcdb6cc54fd3906d06120d0653808
```

下载和校验：

```bash
mkdir -p images

curl -fL --retry 5 --retry-delay 5 \
  "https://files.dog/MSDN/Windows%207/en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso" \
  -o images/en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso

echo "36f4fa2416d0982697ab106e3a72d2e120dbcdb6cc54fd3906d06120d0653808  images/en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso" \
  | sha256sum -c -
```

上述 ISO 地址来自第三方镜像源，并非微软官方服务器。部署前必须确认文件哈希、
来源可信度和 Windows 授权条件。更稳妥的方式是使用组织自行保管的合法 ISO。

## 五、私有部署 Compose 配置

在 `win7` 目录准备以下结构：

```text
win7/
├── docker-compose.yml
├── images/
│   └── en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso
├── oem/
├── shared/
└── storage/
```

Compose 示例：

```yaml
services:
  windows:
    image: local/dockurr-windows:2026-06-12
    pull_policy: never
    container_name: windows

    environment:
      RAM_SIZE: "8G"
      CPU_CORES: "4"
      REGION: "en-US"
      KEYBOARD: "en-US"
      LANGUAGE: "en-US"

    devices:
      - /dev/kvm

    cap_add:
      - NET_ADMIN

    ports:
      - 8006:8006
      - 3389:3389/tcp
      - 3389:3389/udp

    volumes:
      - ./images/en_windows_7_ultimate_with_sp1_x64_dvd_u_677332.iso:/boot.iso:ro
      - ./storage:/storage
      - ./shared:/shared
      - ./oem:/oem

    restart: always
    stop_grace_period: 2m
```

挂载 `/boot.iso` 后，不需要设置 `VERSION: "7u"`，容器会直接使用本地 ISO。
`/storage` 必须持久化，否则重新创建容器时可能丢失 Windows 虚拟磁盘。

## 六、启动

确认本地镜像已经导入：

```bash
docker image inspect "local/dockurr-windows:2026-06-12"
```

启动时禁止拉取远程镜像：

```bash
docker compose up -d --pull never
```

查看日志：

```bash
docker compose logs -f windows
```

安装界面：

```text
http://服务器地址:8006
```

RDP 端口：

```text
服务器地址:3389
```

当前仓库的 `start-docker.sh` 会先执行 `docker compose pull`。完全离线部署时不能
直接使用该拉取流程，应改成检查本地镜像、按需下载镜像包、执行 `docker load`，
最后使用 `docker compose up -d --pull never` 启动。

## 七、更新镜像

1. 在联网机器拉取并测试新版本。
2. 使用新的内部标签，例如 `local/dockurr-windows:2026-07-01`。
3. 重新生成镜像包和 SHA-256。
4. 在目标机器校验并执行 `docker load`。
5. 修改 Compose 中的镜像标签。
6. 执行 `docker compose up -d --pull never`。

更新容器镜像不会自动删除持久化的 `./storage`。

## 八、备份与恢复

备份前先停止容器，避免复制到不一致的虚拟磁盘：

```bash
docker compose down
tar -C . -czf "win7-storage-$(date +%Y%m%d).tar.gz" storage
```

恢复：

```bash
docker compose down
tar -C . -xzf win7-storage-YYYYMMDD.tar.gz
docker compose up -d --pull never
```

不要依赖 `docker commit` 备份 Windows。Windows 系统实际位于 `/storage`，应单独
备份该目录。

## 九、安全注意事项

- Windows 7 已停止安全支持，不应直接暴露到公网。
- 限制 `8006` 和 `3389` 的来源 IP，优先通过 VPN、堡垒机或内网访问。
- 修改默认 Windows 用户密码。
- 下载的镜像包和 ISO 都必须校验 SHA-256。
- HTTP 下载服务优先使用 HTTPS，并配置访问控制。
- 镜像包、ISO 和 `/storage` 应分别管理和备份。

## 参考资料

- dockur/windows：
  <https://github.com/dockur/windows>
- dockur/windows 本地 ISO 挂载说明：
  <https://github.com/dockur/windows#how-do-i-install-a-custom-image>
- Docker `save`：
  <https://docs.docker.com/reference/cli/docker/image/save/>
- Docker `load`：
  <https://docs.docker.com/reference/cli/docker/image/load/>
- Windows 7 版本及镜像源映射：
  <https://github.com/dockur/windows/blob/master/src/define.sh>
