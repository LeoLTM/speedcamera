# program to capture single image from webcam in python
import os
import sys

# importing OpenCV library
import cv2
import time
from statistics import mean
from itertools import combinations_with_replacement
from collections import defaultdict
from numpy.linalg import inv
import threading

import numpy as np
import serial
import serial.tools.list_ports


def list_cameras():
    index = 0
    arr = []
    while True:
        cap = cv2.VideoCapture(index)
        if not cap.read()[0]:
            break
        else:
            arr.append(index)
        cap.release()
        index += 1
    return arr


def leos_enhancer(I):
    img_imported = cv2.imread("opencv_frame_5.png")
    img_to_enhance = cv2.cvtColor(img_imported, cv2.COLOR_BGR2GRAY)
    cols, rows = img_to_enhance.shape
    brightness = np.sum(img_to_enhance) / (255*cols*rows)
    minimum_brightness = 0.66
    alpha = brightness / minimum_brightness

    ratio = brightness / minimum_brightness
    if ratio >= 1:
        print("Image already bright enough")
    else:
        # Otherwise, adjust brightness to get the target brightness
        cv2.convertScaleAbs(img_to_enhance, alpha=1 / ratio, beta=0)
        cv2.imwrite("opencv_frame_5_ENHANCED.png", img_to_enhance)


def get_illumination_channel(I, w):
    M, N, _ = I.shape
    # padding for channels
    padded = np.pad(I, ((int(w/2), int(w/2)), (int(w/2), int(w/2)), (0, 0)), 'edge')
    darkch = np.zeros((M, N))
    brightch = np.zeros((M, N))

    for i, j in np.ndindex(darkch.shape):
        darkch[i, j] = np.min(padded[i:i + w, j:j + w, :]) # dark channel
        brightch[i, j] = np.max(padded[i:i + w, j:j + w, :]) # bright channel

    return darkch, brightch


def get_atmosphere(I, brightch, p=0.1):
    M, N = brightch.shape
    flatI = I.reshape(M*N, 3) # reshaping image array
    flatbright = brightch.ravel() #flattening image array

    searchidx = (-flatbright).argsort()[:int(M*N*p)] # sorting and slicing
    A = np.mean(flatI.take(searchidx, axis=0), dtype=np.float64, axis=0)
    return A


def get_initial_transmission(A, brightch):
    A_c = np.max(A)
    init_t = (brightch-A_c)/(1.-A_c) # finding initial transmission map
    return (init_t - np.min(init_t))/(np.max(init_t) - np.min(init_t)) # normalized initial transmission map


def get_corrected_transmission(I, A, darkch, brightch, init_t, alpha, omega, w):
    im = np.empty(I.shape, I.dtype)
    for ind in range(0, 3):
        im[:, :, ind] = I[:, :, ind] / A[ind] #divide pixel values by atmospheric light
    dark_c, _ = get_illumination_channel(im, w) # dark channel transmission map
    dark_t = 1 - omega*dark_c # corrected dark transmission map
    corrected_t = init_t # initializing corrected transmission map with initial transmission map
    diffch = brightch - darkch # difference between transmission maps

    for i in range(diffch.shape[0]):
        for j in range(diffch.shape[1]):
            if(diffch[i, j] < alpha):
                corrected_t[i, j] = dark_t[i, j] * init_t[i, j]

    return np.abs(corrected_t)


def get_final_image(I, A, refined_t, tmin):
    refined_t_broadcasted = np.broadcast_to(refined_t[:, :, None], (refined_t.shape[0], refined_t.shape[1], 3)) # duplicating the channel of 2D refined map to 3 channels
    J = (I-A) / (np.where(refined_t_broadcasted < tmin, tmin, refined_t_broadcasted)) + A # finding result

    return (J - np.min(J))/(np.max(J) - np.min(J)) # normalized image


def reduce_init_t(init_t):
    init_t = (init_t*255).astype(np.uint8)
    xp = [0, 32, 255]
    fp = [0, 32, 48]
    x = np.arange(256) # creating array [0,...,255]
    table = np.interp(x, xp, fp).astype('uint8') # interpreting fp according to xp in range of x
    init_t = cv2.LUT(init_t, table) # lookup table
    init_t = init_t.astype(np.float64)/255 # normalizing the transmission map
    return init_t


R, G, B = 0, 1, 2  # index for convenience


def boxfilter(I, r):
    """Fast box filter implementation.
    Parameters
    ----------
    I:  a single channel/gray image data normalized to [0.0, 1.0]
    r:  window radius
    Return
    -----------
    The filtered image data.
    """
    M, N = I.shape
    dest = np.zeros((M, N))
    # print(I)

    # cumulative sum over Y axis (tate-houkou no wa)
    sumY = np.cumsum(I, axis=0)
    # print('sumY:{}'.format(sumY))
    # difference over Y axis
    dest[:r + 1] = sumY[r:2 * r + 1]  # top r+1 lines
    dest[r + 1:M - r] = sumY[2 * r + 1:] - sumY[:M - 2 * r - 1]
    # print(sumY[2*r + 1:]) # from 2*r+1 to end lines
    # print(sumY[:M - 2*r - 1]) # same lines of above, from start
    # tile replicate sumY[-1] and line them up to match the shape of (r, 1)
    dest[-r:] = np.tile(sumY[-1], (r, 1)) - sumY[M - 2 * r - 1:M - r - 1]  # bottom r lines

    # cumulative sum over X axis
    sumX = np.cumsum(dest, axis=1)
    # print('sumX:{}'.format(sumX))
    # difference over X axis
    dest[:, :r + 1] = sumX[:, r:2 * r + 1]  # left r+1 columns
    dest[:, r + 1:N - r] = sumX[:, 2 * r + 1:] - sumX[:, :N - 2 * r - 1]
    dest[:, -r:] = np.tile(sumX[:, -1][:, None], (1, r)) - sumX[:, N - 2 * r - 1:N - r - 1]  # right r columns

    # print(dest)

    return dest


def guided_filter(I, p, r=15, eps=1e-3):
    """Refine a filter under the guidance of another (RGB) image.
    Parameters
    -----------
    I:   an M * N * 3 RGB image for guidance.
    p:   the M * N filter to be guided. transmission is used for this case.
    r:   the radius of the guidance
    eps: epsilon for the guided filter
    Return
    -----------
    The guided filter.
    """
    M, N = p.shape
    base = boxfilter(np.ones((M, N)), r)  # this is needed for regularization

    # each channel of I filtered with the mean filter. this is myu.
    means = [boxfilter(I[:, :, i], r) / base for i in range(3)]

    # p filtered with the mean filter
    mean_p = boxfilter(p, r) / base

    # filter I with p then filter it with the mean filter
    means_IP = [boxfilter(I[:, :, i] * p, r) / base for i in range(3)]

    # covariance of (I, p) in each local patch
    covIP = [means_IP[i] - means[i] * mean_p for i in range(3)]

    # variance of I in each local patch: the matrix Sigma in ECCV10 eq.14
    var = defaultdict(dict)
    for i, j in combinations_with_replacement(range(3), 2):
        var[i][j] = boxfilter(I[:, :, i] * I[:, :, j], r) / base - means[i] * means[j]

    a = np.zeros((M, N, 3))
    for y, x in np.ndindex(M, N):
        #         rr, rg, rb
        # Sigma = rg, gg, gb
        #         rb, gb, bb
        Sigma = np.array([[var[R][R][y, x], var[R][G][y, x], var[R][B][y, x]],
                          [var[R][G][y, x], var[G][G][y, x], var[G][B][y, x]],
                          [var[R][B][y, x], var[G][B][y, x], var[B][B][y, x]]])
        cov = np.array([c[y, x] for c in covIP])
        a[y, x] = np.dot(cov, inv(Sigma + eps * np.eye(3)))  # eq 14

    # ECCV10 eq.15
    b = mean_p - a[:, :, R] * means[R] - a[:, :, G] * means[G] - a[:, :, B] * means[B]

    # ECCV10 eq.16
    q = (boxfilter(a[:, :, R], r) * I[:, :, R] + boxfilter(a[:, :, G], r) * I[:, :, G] + boxfilter(a[:, :, B], r) * I[:,
                                                                                                                    :,
                                                                                                                    B] + boxfilter(
        b, r)) / base

    return q


def dehaze(I, tmin=0.1, w=15, alpha=0.4, omega=0.75, p=0.1, eps=1e-3, reduce=False):
    im = np.empty(I.shape, I.dtype)
    I = np.asarray(im, dtype=np.float64)  # Convert the input to a float array.
    I = I[:, :, :3] / 255
    m, n, _ = I.shape
    Idark, Ibright = get_illumination_channel(I, w)
    A = get_atmosphere(I, Ibright, p)

    init_t = get_initial_transmission(A, Ibright)

    if reduce:
        init_t = reduce_init_t(init_t)
    corrected_t = get_corrected_transmission(I, A, Idark, Ibright, init_t, alpha, omega, w)

    normI = (I - I.min()) / (I.max() - I.min())
    refined_t = guided_filter(normI, corrected_t, w, eps)  # applying guided filter
    J_refined = get_final_image(I, A, refined_t, tmin)

    enhanced = (J_refined * 255).astype(np.uint8)
    f_enhanced = cv2.detailEnhance(enhanced, sigma_s=10, sigma_r=0.15)
    f_enhanced = cv2.edgePreservingFilter(f_enhanced, flags=1, sigma_s=64, sigma_r=0.2)
    return f_enhanced


def write_read(x):
    if x == 1:
        arduino.write(bytes(x, 'utf-8'))
        time.sleep(0.05)
        data = arduino.readline()
        return data.decode('utf-8').rstrip()
    else:
        data = arduino.readline()
        return data.decode('utf-8').rstrip()




# num = input("Enter a number: ")



# time.sleep(1)
# arduino.close()
# arduino.open()
# arduino.write("lol")
# time.sleep(3)

# initialize the camera
# If you have multiple camera connected with
# current device, assign a value in cam_port
# variable according to that


# Einstellungen und Initialisierungen
ARD_PORT = '/dev/ttyUSB0'
ARD_BAUD_RATE = 115200
CAM_PORT = 0
imgWindowResolutions = 640, 480
imgPath = os.path.join(os.path.dirname(__file__), "images")
enhancedImgPath = os.path.join(os.path.dirname(__file__), "enhanced")
skipExitOnSetupErr = 0
disableFlash = 0
enableEnhancer = 0

if not os.path.exists(imgPath):
    os.makedirs(imgPath, exist_ok=True)
if not os.path.exists(enhancedImgPath):
    os.makedirs(enhancedImgPath, exist_ok=True)

connected_ports = [tuple(p) for p in list(serial.tools.list_ports.comports())]
matching_ports = [port for port in connected_ports if ARD_PORT in port]
if len(matching_ports) == 0 and not skipExitOnSetupErr:
    sys.exit("Specified port not connected!")

arduino = serial.Serial(ARD_PORT, ARD_BAUD_RATE, timeout=0.1, write_timeout=0.25)

# Kamera-Setup
W, H = 640, 480
cam = cv2.VideoCapture(CAM_PORT, cv2.CAP_DSHOW if os.name == 'nt' else cv2.CAP_ANY)
cam.set(cv2.CAP_PROP_AUTOFOCUS, 0)  # Disable auto-focus if supported
cam.set(cv2.CAP_PROP_FRAME_WIDTH, W)
cam.set(cv2.CAP_PROP_FRAME_HEIGHT, H)
cam.set(cv2.CAP_PROP_FPS, 30)

if not cam.isOpened():
    sys.exit("Could not open video device.")

cv2.namedWindow("SpeedCam", cv2.WINDOW_NORMAL)
cv2.resizeWindow("SpeedCam", imgWindowResolutions[0], imgWindowResolutions[1])

# Thread für das Speichern und Verarbeiten der Bilder
class FrameSaver(threading.Thread):
    def __init__(self):
        super().__init__()
        self.frames_queue = []
        self.lock = threading.Lock()
        self.running = True

    def add_frame(self, frame, speed, img_counter):
        with self.lock:
            self.frames_queue.append((frame, speed, img_counter))

    def run(self):
        while self.running or len(self.frames_queue) > 0:
            with self.lock:
                if len(self.frames_queue) > 0:
                    frame, speed, img_counter = self.frames_queue.pop(0)
                else:
                    continue

            # Bild verarbeiten und speichern
            img_name = f"opencv_frame_{img_counter}.png"
            img_name_enhanced = f"opencv_frame_{img_counter}_enhanced.png"
            cv2.putText(frame, str(speed), (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2, cv2.LINE_AA)
            cv2.imwrite(os.path.join(imgPath, img_name), frame)

            if enableEnhancer:
                enhanced_img = dehaze(frame)
                cv2.imwrite(os.path.join(enhancedImgPath, img_name_enhanced), enhanced_img)

            print(f"Saved {img_name} with speed: {speed}")

    def stop(self):
        self.running = False

frame_saver = FrameSaver()
frame_saver.start()

img_counter = 0

# Haupt-Loop: Frames grabben und verarbeiten
try:
    while True:
        time.sleep(0.05)
        status = arduino.readline().decode('utf-8').rstrip()
        if status:
            print(status)

        if status == '2':  # Nicht ausgelöst
            print("Nicht ausgelöst...")
            cam.grab()
        elif status.startswith('3') or cv2.waitKey(1) % 256 == 32:  # Auslösung
            print("ZU SCHNELL!")
            speed = status[1:] if len(status) > 1 else "Manual Trigger"

            if disableFlash != 1:
                arduino.write(b'5')
            time.sleep(0.1)

            # Clear the buffer and capture the latest frame
            for _ in range(5):  # Adjust the number of frames to flush the buffer
                cam.grab()
            _, frame = cam.retrieve()  # Decode the most recent frame

            frame_saver.add_frame(frame, speed, img_counter)  
            cv2.imshow("SpeedCam", frame)
            img_counter += 1

        if cv2.waitKey(1) % 256 == 27:  # ESC zum Beenden
            print("ESC pressed, exiting...")
            break
finally:
    frame_saver.stop()
    frame_saver.join()
    cam.release()
    cv2.destroyAllWindows()






