# -*- coding: utf-8 -*-
"""
Spyder Editor

This is a temporary script file.
"""
import numpy as np
import matplotlib.pyplot as plt
from frake import FileFunctions as FF
from frake import GraphFunctions as GF
from frake import ModifierFunctioins as MF
import subprocess
import os
import shutil

class loading:
    """docstring for loading."""
    def __init__(self, drain=False, control='E', path='TX', load=-0.2, NSTEPS=1000\
                , MAXITER=200, INC=10, DTIME=10000000):
        if isinstance(drain, bool):
            self.drain = drain
        else:
            print("Drainage is either True (drained) or False (undrained)")
            self.drain=False

        if (control=='S'):
            self.control='S'
        elif (control=='E'):
            self.control='E'
        else:
            print("control is either strain ('E') or stress ('S') controlled")
            self.control='E'

        self.path=path
        self.load=load
        self.NSTEPS=NSTEPS
        self.MAXITER=MAXITER
        self.INC=INC
        self.DTIME=DTIME

class LoadBatch:
    def __init__(self, name):
        self.name = name
        self.loads=[]
        
    def add_load(self, load):
        self.loads.append(load)

    def delete_loads(self):
        self.loads=[]

    def total_loads(self):
        return len(self.loads)




# post processing functions
def Get_stress_invariants(Sig):
    p=(Sig[0]+Sig[1]+Sig[2])/3.0 # Mean stress 1/3 tr(Sig)

    dev=Sig
    dev[0]=dev[0]-p
    dev[1]=dev[1]-p
    dev[2]=dev[2]-p #deviatoric stress tensor S

    norm=0
    for i in range(len(dev)):# S:S
        if (i<3):
            norm=norm+dev[i]**2
        else:
            norm=norm+2*dev[i]**2

    q=np.sqrt(3*norm/2) #sqrt(3/2 S:S)
    p=-p #Positive for compression
    return q, p

def Get_strain_invariants(Eps):
    eps_v=Eps[0]+Eps[1]+Eps[2]# vol strain tr(Eps)

    dev=Eps
    dev[0]=dev[0]-eps_v/3
    dev[1]=dev[1]-eps_v/3
    dev[2]=dev[2]-eps_v/3 #deviatoric strain tensor e

    norm=0
    for i in range(len(dev)):# e:e
        if (i<3):
            norm=norm+dev[i]**2
        else:
            norm=norm+0.5*dev[i]**2 #UMAT convention is to use shear strain

    eps_q=np.sqrt(2*norm/3) #sqrt(2/3 e:e)
    eps_v=-eps_v #Positive for compression
    return eps_q, eps_v

#The following is a function that generates the input files
def NAMCVMAT_Run(sigma, G, nu, Mtc, N, Dmin, h, kG, loads,\
                 kK=0, kD=0, Dpart=0, Gs=2.65, refrate=0,\
                smooth=0, degree=0, original=0,\
                foldername="mymodel", outputfile="output", Plot=True):

    #__________________________________________________________________________
    #Step 0: prepares folder destination
    #__________________________________________________________________________
    # Get executable path
    full_path=os.getcwd()
    folderpath=r"%s\%s" %(full_path, foldername)
    #Delete folder if it exist
    if not(os.path.exists(foldername)):
            os.mkdir(foldername)

    exe_path=full_path #executable must be in the same folder
    print(exe_path)
    exe=r"%s\%s" %(exe_path, "incrementalDriver.exe")
    dll1=r"%s\%s" %(full_path, r"dlls\libifcoremd.dll")#After I installed OneAPI I need to put this dlls next to my exe file
                                                       #Not needed outside jupyter
    dll2=r"%s\%s" %(full_path, r"dlls\libifcoremdd.dll")#After I installed OneAPI I need to put this dlls next to my exe file
                                                       #Not needed outside jupyter
    # Copy the executable into the benchmark path
    shutil.copy(exe, folderpath)
    shutil.copy(dll1, folderpath)
    shutil.copy(dll2, folderpath)
    #_____________________________________________________________________

    #______________________________________________________________________
    #Step 1: create parameters.inp file
    #______________________________________________________________________
    f=open('%s\parameters.inp' %(folderpath), 'w+') #Create an empty file
    f.write('NAMCVMAT\n')
    f.write('15\n')
    f.write('%s\n' % G)    # Shear Modulus
    f.write('%s\n' % nu)   # Poisson's ratio
    f.write('%s\n' % Mtc)  # M_tc
    f.write('%s\n' % N)    # Nova's coupling coeff.
    f.write('%s\n' % Dmin) # Minimum dilatancy
    f.write('%s\n' % h)    # hardening modulus
    f.write('%s\n' % kG)   # kappa_G
    f.write('%s\n' % kK)   # kappa_k
    f.write('%s\n' % kD)   # kappa_D
    f.write('%s\n' % Dpart)# particle size
    f.write('%s\n' % Gs)   # specific gravity
    f.write('%s\n' % refrate)#Reference strain rate
    f.write('%s\n' % smooth) #Apply smoothening algorithm (false=0)
    f.write('%s\n' % degree) #Degree of smoothing
    f.write('%s' % original) #dahspot or original method
    f.close() #close file
    #_________________________________________________________________

    #_________________________________________________________________
    #Step 2: write initialconditions.inp file
    #_________________________________________________________________
    f=open('%s\initialconditions.inp' %(folderpath), 'w+') #Create an empty file
    f.write('6\n')
    f.write('%s\n' % sigma[0]) #Cell pressure
    f.write('%s\n' % sigma[1]) #Cell pressure
    f.write('%s\n' % sigma[2]) #Cell pressure
    f.write('%s\n' % sigma[3]) #shear
    f.write('%s\n' % sigma[4]) #shear
    f.write('%s\n' % sigma[5]) #shear
    f.write('19\n') #State parameters being stored
    for i in range(0,19):
        f.write('0\n') # zeroed state paramters
    f.close() #close file
    #___________________________________________________________________

    #___________________________________________________________________
    #Step 3: create test.inp file
    #___________________________________________________________________
    nloads=loads.total_loads()

    name_f='%s.txt' % outputfile #name of output files
    f=open('%s\\test.inp' %(folderpath), 'w+') #Create an empty file
    f.write('%s\n' % name_f)

    for i in range(nloads):
        if (loads.loads[i].path=='TX'):#Triaxial
            if (loads.loads[i].control=='E'):
                if (loads.loads[i].drain):
                    f.write('*TriaxialE1\n') # strain controlled CD test (need to generalize)
                    f.write('%s %s %s: %s\n' % (loads.loads[i].NSTEPS,loads.loads[i].MAXITER,\
                                                loads.loads[i].DTIME, loads.loads[i].INC) )#numerical values
                    f.write('%s\n'% loads.loads[i].load) #axial strain
                else:
                    f.write('*TriaxialUEq\n') # strain controlled CD test (need to generalize)
                    f.write('%s %s %s: %s\n' % (loads.loads[i].NSTEPS,loads.loads[i].MAXITER,\
                                                loads.loads[i].DTIME, loads.loads[i].INC) )#numerical values
                    f.write('%s\n'% loads.loads[i].load) #axial strain
            elif (loads.loads[i].control=='S'):
                if (loads.loads[i].drain):
                    f.write('*TriaxialS1\n') # strain controlled CD test (need to generalize)
                    f.write('%s %s %s: %s\n' % (loads.loads[i].NSTEPS,loads.loads[i].MAXITER,\
                                                loads.loads[i].DTIME, loads.loads[i].INC) )#numerical values
                    f.write('%s\n'% loads.loads[i].load) #axial strain
                else:
                    f.write('*TriaxialUq\n') # strain controlled CD test (need to generalize)
                    f.write('%s %s %s: %s\n' % (loads.loads[i].NSTEPS,loads.loads[i].MAXITER,\
                                                loads.loads[i].DTIME, loads.loads[i].INC) )#numerical values
                    f.write('%s\n'% loads.loads[i].load) #axial strain
#         elif (loads.loads[i].path=='SS'):#Simpleshear
#         elif (loads.loads[i].path=='REL'):#relaxation
#         elif (loads.loads[i].path=='CRE'):#creep
#         elif (loads.loads[i].path=='EDO'):#eodometric
#         elif (loads.loads[i].path=='CYC'):#cyclic
        elif (loads.loads[i].path=='TRAN'):#transient
            if (loads.loads[i].control=='E'): #strain controlled
                if (loads.loads[i].drain):
                    f.write('*ImpactTriaxialE1\n')
                    f.write('loading.strt\n')
                    f.write('%s %s %s: %s\n' % (loads.loads[i].NSTEPS,loads.loads[i].MAXITER,\
                                                loads.loads[i].DTIME, loads.loads[i].INC) )#numerical values
                    f.write('111111111\n') #axial strain
#                 else:
#                     f.write('*TriaxialUEq\n') # strain controlled CD test (need to generalize)
#                     f.write('%s %s %s: %s\n' % (loads.loads[i].NSTEPS,loads.loads[i].MAXITER,\
#                                                 loads.loads[i].DTIME, loads.loads[i].INC) )#numerical values
#                     f.write('%s\n'% loads.loads[i].load) #axial strain
#             elif (loads.loads[i].control=='S'):
#                 if (loads.loads[i].drain):
#                     f.write('*TriaxialS1\n') # strain controlled CD test (need to generalize)
#                     f.write('%s %s %s: %s\n' % (loads.loads[i].NSTEPS,loads.loads[i].MAXITER,\
#                                                 loads.loads[i].DTIME, loads.loads[i].INC) )#numerical values
#                     f.write('%s\n'% loads.loads[i].load) #axial strain
#                 else:
#                     f.write('*TriaxialUq\n') # strain controlled CD test (need to generalize)
#                     f.write('%s %s %s: %s\n' % (loads.loads[i].NSTEPS,loads.loads[i].MAXITER,\
#                                                 loads.loads[i].DTIME, loads.loads[i].INC) )#numerical values
#                     f.write('%s\n'% loads.loads[i].load) #axial strain

        f.close() #close file
        if (loads.loads[i].path=='TRAN'): #Generates loading file
            f=open('%s\\loading.strt' %(folderpath), 'w+') #Create an empty file
            f.write('%s\n' % (len(loads.loads[i].load['t'])))
            for k in range(len(loads.loads[i].load['t'])):
                f.write('%s	%s\n' % (loads.loads[i].load['t'][k], loads.loads[i].load['f'][k]))
            f.close() #close file       
    #___________________________________________________________________

    #___________________________________________________________________
    # Step 4: Run the code
    #___________________________________________________________________
    cmd=r"%s\incrementalDriver.exe" % (folderpath) #executable as comand
    print(cmd)
#     os.system('cmd %s "incrementalDriver"' %foldernamepath)
    process = subprocess.Popen(cmd, cwd = folderpath) #Runs comand in cmd
    process.wait() #Wait until it is finished
    #___________________________________________________________________

    #___________________________________________________________________
    # Step 5: Read data
    #___________________________________________________________________
    model_resutls, _, _=FF.OpenFromFolder(Path=folderpath, filetype='txt')#opens data
    #___________________________________________________________________

    #___________________________________________________________________
    #Step 6: Postprocess the results
    #___________________________________________________________________
    MF.DataOperation(model_resutls, '*', 'stran(1)', -100, 'Epsa') #axial strain in % and positive
    for frame in model_resutls:#Now compute invariants and write them
        Sig=[frame['stress(1)'], frame['stress(2)'], frame['stress(3)'], \
             frame['stress(4)'], frame['stress(5)'], frame['stress(6)']]
        q, p=Get_stress_invariants(Sig)
        frame['q']=q
        frame['p']=p

        Eps=[frame['stran(1)'], frame['stran(2)'], frame['stran(3)'], \
             frame['stran(4)'], frame['stran(5)'], frame['stran(6)']]
        Eps_q, Eps_v=Get_strain_invariants(Eps)
        frame['Epsq']=Eps_q*100 #In %
        frame['Epsv']=Eps_v*100 #in %
    #_____________________________________________________________________

    #_____________________________________________________________________
    # Step 7: Plot q vs epsa and epsv vs eps a
    #_____________________________________________________________________
    if (Plot):
        fig, axs=plt.subplots(2)
        xsize=3.4
        aspect_ratio=1.5
        ysize=2*xsize/aspect_ratio
        GF.PlotAll(model_resutls, ['1'], 'Epsa', 'q', xlabel=r'Axial strain ($\varepsilon_a$) [$\%$]'\
                 , ylabel=r'Deviatoric stress ($q$) [kPa]', hold=1, PlotName=axs[0], legendMode=False)
        GF.PlotAll(model_resutls, ['1'], 'Epsa', 'Epsv', xlabel=r'Axial strain ($\varepsilon_a$) [$\%$]'\
                 , ylabel=r'Vol. strain ($\varepsilon_v$) [$\%$]', hold=1, PlotName=axs[1], \
                   legendMode=False, xsize=xsize, ysize=ysize)
        plt.tight_layout()
    #_____________________________________________________________________

    return model_resutls
